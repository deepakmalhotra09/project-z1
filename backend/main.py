"""
Lead Distribution Portal - FastAPI Backend
Handles lead ingestion, SQLite storage, WebSocket real-time updates,
and HubSpot CRM synchronization.
"""

import asyncio
import json
import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, validator

load_dotenv()

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger(__name__)

# ─── Config ──────────────────────────────────────────────────────────────────
HUBSPOT_TOKEN = os.getenv("HUBSPOT_ACCESS_TOKEN", "")
DB_PATH = os.getenv("DB_PATH", "./leads.db")
CORS_ORIGINS_STR = os.getenv(
    "CORS_ORIGINS", 
    "http://localhost:3000,https://project-z1-iq6j.vercel.app"
)
CORS_ORIGINS = [origin.strip() for origin in CORS_ORIGINS_STR.split(",") if origin.strip()]

BUDGET_PIPELINE_MAP = {
    "Under $10k": 5000,
    "$10k-$50k": 30000,
    "Greater than $50k": 75000,
}

HUBSPOT_API_BASE = "https://api.hubapi.com"

# ─── Database Setup ───────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name      TEXT NOT NULL,
            last_name       TEXT NOT NULL,
            email           TEXT NOT NULL,
            company         TEXT NOT NULL,
            budget          TEXT NOT NULL,
            pipeline_value  INTEGER NOT NULL,
            local_status    TEXT NOT NULL DEFAULT 'received',
            hubspot_status  TEXT NOT NULL DEFAULT 'pending',
            hubspot_contact_id TEXT,
            created_at      TEXT NOT NULL,
            synced_at       TEXT
        )
    """)
    conn.commit()
    conn.close()
    log.info("Database initialised at %s", DB_PATH)


def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def insert_lead(data: dict) -> dict:
    conn = db_conn()
    now = datetime.utcnow().isoformat()
    cur = conn.execute(
        """INSERT INTO leads
           (first_name, last_name, email, company, budget, pipeline_value,
            local_status, hubspot_status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            data["first_name"], data["last_name"], data["email"],
            data["company"], data["budget"],
            BUDGET_PIPELINE_MAP.get(data["budget"], 0),
            "received", "pending", now,
        ),
    )
    lead_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    conn.close()
    return dict(row)


def update_lead_hubspot(lead_id: int, hubspot_status: str, hubspot_contact_id: Optional[str] = None):
    conn = db_conn()
    now = datetime.utcnow().isoformat()
    conn.execute(
        """UPDATE leads SET hubspot_status=?, hubspot_contact_id=?, synced_at=?
           WHERE id=?""",
        (hubspot_status, hubspot_contact_id, now, lead_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    conn.close()
    return dict(row)


def get_all_leads() -> list:
    conn = db_conn()
    rows = conn.execute("SELECT * FROM leads ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_analytics() -> dict:
    conn = db_conn()
    total = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
    pipeline = conn.execute("SELECT COALESCE(SUM(pipeline_value),0) FROM leads").fetchone()[0]
    synced = conn.execute("SELECT COUNT(*) FROM leads WHERE hubspot_status='synced'").fetchone()[0]
    failed = conn.execute("SELECT COUNT(*) FROM leads WHERE hubspot_status='failed'").fetchone()[0]
    conn.close()
    return {
        "total_leads": total,
        "total_pipeline_value": pipeline,
        "synced_count": synced,
        "failed_count": failed,
    }


# ─── WebSocket Manager ────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        log.info("WS client connected. Total: %d", len(self.active))

    def disconnect(self, ws: WebSocket):
        self.active = [c for c in self.active if c != ws]
        log.info("WS client disconnected. Total: %d", len(self.active))

    async def broadcast(self, payload: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


# ─── HubSpot Integration ──────────────────────────────────────────────────────
async def sync_to_hubspot(lead: dict) -> tuple[str, Optional[str]]:
    """
    Creates or updates a HubSpot contact and deal for the lead.
    Returns (status, hubspot_contact_id).
    """
    if not HUBSPOT_TOKEN:
        log.warning("HUBSPOT_ACCESS_TOKEN not set — skipping HubSpot sync")
        return "skipped", None

    headers = {
        "Authorization": f"Bearer {HUBSPOT_TOKEN}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=15) as client:
        # ── 1. Create / upsert contact ────────────────────────────────────────
        contact_payload = {
            "properties": {
                "firstname": lead["first_name"],
                "lastname": lead["last_name"],
                "email": lead["email"],
                "company": lead["company"],
                "hs_lead_status": "NEW",
                "lead_source_detail": "Lead Distribution Portal",
            }
        }

        # Try upsert by email first
        search_resp = await client.post(
            f"{HUBSPOT_API_BASE}/crm/v3/objects/contacts/search",
            headers=headers,
            json={
                "filterGroups": [{
                    "filters": [{"propertyName": "email", "operator": "EQ", "value": lead["email"]}]
                }],
                "limit": 1,
            },
        )

        contact_id = None
        if search_resp.status_code == 200 and search_resp.json().get("total", 0) > 0:
            contact_id = search_resp.json()["results"][0]["id"]
            patch_resp = await client.patch(
                f"{HUBSPOT_API_BASE}/crm/v3/objects/contacts/{contact_id}",
                headers=headers,
                json=contact_payload,
            )
            if patch_resp.status_code not in (200, 204):
                log.error("HubSpot contact update failed: %s", patch_resp.text)
                return "failed", None
        else:
            create_resp = await client.post(
                f"{HUBSPOT_API_BASE}/crm/v3/objects/contacts",
                headers=headers,
                json=contact_payload,
            )
            if create_resp.status_code not in (200, 201):
                log.error("HubSpot contact create failed: %s", create_resp.text)
                return "failed", None
            contact_id = create_resp.json()["id"]

        # ── 2. Create a Deal linked to the contact ────────────────────────────
        deal_payload = {
            "properties": {
                "dealname": f"{lead['company']} — {lead['budget']}",
                "amount": str(BUDGET_PIPELINE_MAP.get(lead["budget"], 0)),
                "dealstage": "appointmentscheduled",
                "pipeline": "default",
                "closedate": "",
                "lead_budget_tier": lead["budget"],
            },
            "associations": [
                {
                    "to": {"id": contact_id},
                    "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 3}],
                }
            ],
        }

        deal_resp = await client.post(
            f"{HUBSPOT_API_BASE}/crm/v3/objects/deals",
            headers=headers,
            json=deal_payload,
        )
        if deal_resp.status_code not in (200, 201):
            log.error("HubSpot deal create failed: %s", deal_resp.text)
            # Contact was created; still mark partial success
            return "synced", contact_id

        log.info("HubSpot sync OK — contact %s", contact_id)
        return "synced", contact_id


# ─── HubSpot Connection Check ─────────────────────────────────────────────────
async def check_hubspot_connection() -> dict:
    if not HUBSPOT_TOKEN:
        return {"connected": False, "reason": "No access token configured"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{HUBSPOT_API_BASE}/crm/v3/objects/contacts?limit=1",
                headers={"Authorization": f"Bearer {HUBSPOT_TOKEN}"},
            )
            if r.status_code == 200:
                return {"connected": True, "reason": "Authenticated"}
            elif r.status_code == 401:
                return {"connected": False, "reason": "Invalid or expired token"}
            else:
                return {"connected": False, "reason": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"connected": False, "reason": str(e)}


# ─── App Lifespan ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Lead Distribution Portal API", version="1.0.0", lifespan=lifespan)

# Log CORS configuration for debugging
log.info("CORS Origins configured: %s", CORS_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ─── Pydantic Models ──────────────────────────────────────────────────────────
VALID_BUDGETS = {"Under $10k", "$10k-$50k", "Greater than $50k"}


class LeadSubmission(BaseModel):
    first_name: str
    last_name: str
    email: str
    company: str
    budget: str

    @validator("first_name", "last_name", "company")
    def not_empty(cls, v):
        if not v.strip():
            raise ValueError("Field cannot be empty")
        return v.strip()

    @validator("budget")
    def valid_budget(cls, v):
        if v not in VALID_BUDGETS:
            raise ValueError(f"Budget must be one of: {VALID_BUDGETS}")
        return v

    @validator("email")
    def valid_email(cls, v):
        import re
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(pattern, v):
            raise ValueError("Invalid email address")
        return v.lower().strip()


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.post("/api/leads", status_code=201)
async def submit_lead(payload: LeadSubmission):
    lead = insert_lead(payload.dict())
    log.info("Lead ingested: id=%d email=%s", lead["id"], lead["email"])

    # Broadcast new lead to all dashboard clients
    await manager.broadcast({"event": "new_lead", "lead": lead, "analytics": get_analytics()})

    # Async HubSpot sync (fire and forget — dashboard updates via WS)
    asyncio.create_task(sync_lead_and_notify(lead))

    return JSONResponse(
        status_code=201,
        content={"success": True, "lead_id": lead["id"], "message": "Lead received. HubSpot sync in progress."},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    )


async def sync_lead_and_notify(lead: dict):
    """Sync to HubSpot and push WS update with result."""
    try:
        status, hs_id = await sync_to_hubspot(lead)
        updated = update_lead_hubspot(lead["id"], status, hs_id)
        await manager.broadcast({
            "event": "lead_updated",
            "lead": updated,
            "analytics": get_analytics(),
        })
        log.info("HubSpot sync result for lead %d: %s", lead["id"], status)
    except Exception as e:
        log.error("HubSpot sync error for lead %d: %s", lead["id"], str(e))
        updated = update_lead_hubspot(lead["id"], "failed")
        await manager.broadcast({
            "event": "lead_updated",
            "lead": updated,
            "analytics": get_analytics(),
        })


@app.get("/api/leads")
async def list_leads():
    return {"leads": get_all_leads(), "analytics": get_analytics()}


@app.get("/api/hubspot/status")
async def hubspot_status():
    result = await check_hubspot_connection()
    return result


@app.post("/api/leads/{lead_id}/retry")
async def retry_lead(lead_id: int):
    conn = db_conn()
    row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Lead not found")
    lead = dict(row)
    if lead["hubspot_status"] == "synced":
        raise HTTPException(status_code=400, detail="Lead already synced")
    asyncio.create_task(sync_lead_and_notify(lead))
    return {"success": True, "message": "Retry initiated"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        # Send initial state on connection
        await ws.send_json({
            "event": "init",
            "leads": get_all_leads(),
            "analytics": get_analytics(),
        })
        while True:
            await ws.receive_text()  # keep alive
    except WebSocketDisconnect:
        manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

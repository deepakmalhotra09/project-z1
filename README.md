# Lead Distribution Portal


Versel.com for deployment of the app 
github url for the application

A full-stack application that ingests leads via a public web form, stores them in SQLite,
pushes them to HubSpot CRM in real time, and shows a live monitoring dashboard.

```
[Web Form] → [FastAPI Backend] → [SQLite DB]
                    │                  ↕ WebSocket
                    ↓            [React Dashboard]
              [HubSpot CRM API]
```

---

## Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Backend   | Python 3.11+, FastAPI, Uvicorn, httpx   |
| Database  | SQLite (zero-config, file-based)        |
| Frontend  | React 18, React Router v6              |
| Real-time | WebSockets (native FastAPI + browser)  |
| CRM       | HubSpot CRM API v3 (Contacts + Deals)  |

---

## Project Structure

```
lead-portal/
├── backend/
│   ├── main.py            # FastAPI app — all routes, WS, HubSpot sync
│   ├── requirements.txt
│   ├── .env.example       # Copy to .env and fill in your HubSpot token
│   └── leads.db           # Auto-created on first run
└── frontend/
    ├── public/index.html
    └── src/
        ├── App.js                # Shell + routing + sidebar
        ├── useLeadSocket.js      # WebSocket hook (auto-reconnect)
        ├── index.css             # Design system + all styles
        └── pages/
            ├── Dashboard.jsx     # Live feed, analytics, HubSpot status
            └── LeadForm.jsx      # Public-facing submission form
```

---

## Quick Start

### 1 — HubSpot Setup

1. Log in to your HubSpot Developer Sandbox account.
2. Go to **Settings → Integrations → Private Apps** and create a new Private App.
3. Grant these scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.deals.read`
   - `crm.objects.deals.write`
4. Copy the **Access Token**.

### 2 — Backend

```bash
cd backend

# Copy and edit env file
cp .env.example .env
# → Set HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxxxx...

# Install dependencies
pip install -r requirements.txt

# Start the server
python main.py
# → Listening on http://localhost:8000
```

### 3 — Frontend

```bash
cd frontend
npm install
npm start
# → Opens http://localhost:3000
```

---

## API Reference

| Method | Path                       | Description                            |
|--------|----------------------------|----------------------------------------|
| POST   | `/api/leads`               | Ingest a new lead                      |
| GET    | `/api/leads`               | List all leads + analytics             |
| POST   | `/api/leads/{id}/retry`    | Retry failed HubSpot sync             |
| GET    | `/api/hubspot/status`      | Check HubSpot API connectivity         |
| GET    | `/health`                  | Health check                           |
| WS     | `/ws`                      | WebSocket — real-time lead events      |

### POST /api/leads — Request Body

```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@company.com",
  "company": "Acme Corp",
  "budget": "Under $10k"  // or "$10k-$50k" or "Greater than $50k"
}
```

### WebSocket Events

```json
// On connection
{ "event": "init", "leads": [...], "analytics": {...} }

// When a new lead arrives
{ "event": "new_lead", "lead": {...}, "analytics": {...} }

// When HubSpot sync completes
{ "event": "lead_updated", "lead": {...}, "analytics": {...} }
```

---

## HubSpot Sync Flow

1. Lead submitted → saved to SQLite with `hubspot_status: "pending"`
2. Backend fires async task to call HubSpot API:
   - Searches for existing contact by email (upsert pattern)
   - Creates/updates **Contact** with name, email, company, lead source
   - Creates **Deal** linked to the contact with budget-derived amount and stage
3. `hubspot_status` updated to `"synced"` (or `"failed"`)
4. WebSocket broadcasts update to all connected dashboard clients

---

## Budget → Pipeline Value Mapping

| Budget Tier    | Pipeline Value Used |
|----------------|---------------------|
| Under $10k     | $5,000              |
| $10k–$50k      | $30,000             |
| Greater than $50k | $75,000          |

---

## Environment Variables

| Variable              | Default               | Description                       |
|-----------------------|-----------------------|-----------------------------------|
| `HUBSPOT_ACCESS_TOKEN`| *(required)*          | HubSpot Private App token         |
| `BACKEND_HOST`        | `0.0.0.0`             | Uvicorn bind host                 |
| `BACKEND_PORT`        | `8000`                | Uvicorn bind port                 |
| `DB_PATH`             | `./leads.db`          | SQLite database path              |
| `CORS_ORIGINS`        | `http://localhost:3000` | Comma-separated allowed origins |

For the frontend, set `REACT_APP_API_URL` and `REACT_APP_WS_URL` in a `.env` file:

```
REACT_APP_API_URL=http://localhost:8000
REACT_APP_WS_URL=ws://localhost:8000/ws
```

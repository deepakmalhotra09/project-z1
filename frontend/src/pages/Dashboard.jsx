import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLeadSocket } from '../useLeadSocket';
import { useTheme } from '../ThemeContext';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const BUDGET_VALUES = {
  'Under $10k':      5000,
  '$10k-$50k':      30000,
  'Greater than $50k': 75000,
};

function fmt$(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function StatusPill({ status }) {
  const label = {
    synced:   'Synced',
    pending:  'Pending',
    failed:   'Failed',
    skipped:  'Skipped',
    received: 'Received',
  }[status] ?? status;

  return (
    <span className={`pill ${status}`}>
      <span className="pill-dot" />
      {label}
    </span>
  );
}

function HsStatusPanel() {
  const [hs, setHs] = useState({ state: 'checking', reason: '' });

  const check = async () => {
    setHs({ state: 'checking', reason: '' });
    try {
      const r = await fetch(`${API}/api/hubspot/status`);
      const d = await r.json();
      setHs({ state: d.connected ? 'connected' : 'disconnected', reason: d.reason });
    } catch {
      setHs({ state: 'disconnected', reason: 'Backend unreachable' });
    }
  };

  useEffect(() => { check(); }, []);

  const cls = hs.state === 'connected' ? 'connected' : hs.state === 'checking' ? 'checking' : 'disconnected';
  const label = { connected: '● Connected', disconnected: '● Disconnected', checking: '◌ Checking…' }[hs.state];

  return (
    <div className="hs-status-card">
      <div className="hs-status-left">
        <div className="hs-icon">🟠</div>
        <div className="hs-info">
          <h3>HubSpot CRM Integration</h3>
          <p>{hs.reason || 'Verifying API connection…'}</p>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className={`connection-indicator ${cls}`}>
          <span className="conn-dot" />
          {label}
        </div>
        <button
          onClick={check}
          style={{
            fontSize: 11, padding: '5px 10px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

function AnalyticsBadge({ label, value, sub, accent }) {
  return (
    <div className={`badge-card ${accent}`}>
      <div className="badge-label">{label}</div>
      <div className="badge-value">{value}</div>
      {sub && <div className="badge-sub">{sub}</div>}
    </div>
  );
}

export default function Dashboard({ wsConnected }) {
  const [leads, setLeads] = useState([]);
  const [analytics, setAnalytics] = useState({ total_leads: 0, total_pipeline_value: 0, synced_count: 0, failed_count: 0 });
  const [flashIds, setFlashIds] = useState(new Set());
  const flashTimeout = useRef({});
  const { isDark, toggleTheme } = useTheme();

  const flash = (id) => {
    setFlashIds((prev) => new Set([...prev, id]));
    clearTimeout(flashTimeout.current[id]);
    flashTimeout.current[id] = setTimeout(() => {
      setFlashIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }, 800);
  };

  const handleEvent = useCallback((msg) => {
    if (msg.event === 'init') {
      setLeads(msg.leads || []);
      if (msg.analytics) setAnalytics(msg.analytics);
    } else if (msg.event === 'new_lead') {
      setLeads((prev) => [msg.lead, ...prev.filter(l => l.id !== msg.lead.id)]);
      if (msg.analytics) setAnalytics(msg.analytics);
      flash(msg.lead.id);
    } else if (msg.event === 'lead_updated') {
      setLeads((prev) => prev.map(l => l.id === msg.lead.id ? msg.lead : l));
      if (msg.analytics) setAnalytics(msg.analytics);
      flash(msg.lead.id);
    }
  }, []);

  useLeadSocket({ onEvent: handleEvent });

  // Initial fetch as fallback
  useEffect(() => {
    fetch(`${API}/api/leads`)
      .then(r => r.json())
      .then(d => {
        setLeads(d.leads || []);
        if (d.analytics) setAnalytics(d.analytics);
      })
      .catch(() => {});
  }, []);

  const handleRetry = async (id) => {
    try {
      await fetch(`${API}/api/leads/${id}/retry`, { method: 'POST' });
    } catch {}
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Lead Dashboard</h2>
          <p>Real-time monitoring of lead ingestion and HubSpot synchronisation status.</p>
        </div>
        <button className="theme-btn" onClick={toggleTheme} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          {isDark ? '☀️' : '🌙'}
        </button>
      </div>

      <div className="page-body">
        {/* Analytics */}
        <div className="analytics-grid">
          <AnalyticsBadge
            label="Total Leads"
            value={analytics.total_leads}
            sub="All time ingested"
            accent="blue"
          />
          <AnalyticsBadge
            label="Pipeline Value"
            value={fmt$(analytics.total_pipeline_value)}
            sub="Estimated total"
            accent="green"
          />
          <AnalyticsBadge
            label="HubSpot Synced"
            value={analytics.synced_count}
            sub="Successfully pushed"
            accent="sky"
          />
          <AnalyticsBadge
            label="Sync Failed"
            value={analytics.failed_count}
            sub="Needs attention"
            accent="amber"
          />
        </div>

        {/* HubSpot Router Control */}
        <HsStatusPanel />

        {/* Live Lead Feed */}
        <div className="card-title">Live Lead Feed</div>
        {leads.length === 0 ? (
          <div className="table-wrap">
            <div className="empty-state">
              <div className="icon">📭</div>
              <p>No leads yet. Submit a lead using the form to see it appear here in real time.</p>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name / Email</th>
                  <th>Company</th>
                  <th>Budget</th>
                  <th>Local Status</th>
                  <th>HubSpot Status</th>
                  <th>HS Contact ID</th>
                  <th>Received</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className={flashIds.has(lead.id) ? 'flash' : ''}>
                    <td className="mono">{lead.id}</td>
                    <td>
                      <div className="lead-name">{lead.first_name} {lead.last_name}</div>
                      <div className="lead-email">{lead.email}</div>
                    </td>
                    <td>{lead.company}</td>
                    <td><span className="budget-tag">{lead.budget}</span></td>
                    <td><StatusPill status={lead.local_status} /></td>
                    <td><StatusPill status={lead.hubspot_status} /></td>
                    <td>
                      {lead.hubspot_contact_id
                        ? <span className="hs-id">{lead.hubspot_contact_id}</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                    </td>
                    <td className="mono">
                      {new Date(lead.created_at + 'Z').toLocaleString(undefined, {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td>
                      {lead.hubspot_status === 'failed' && (
                        <button className="btn-retry" onClick={() => handleRetry(lead.id)}>
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

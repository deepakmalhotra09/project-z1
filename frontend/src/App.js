import React, { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import LeadForm from './pages/LeadForm';
import { useLeadSocket } from './useLeadSocket';
import { ThemeProvider, useTheme } from './ThemeContext';

function Sidebar({ wsConnected }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">⚡</div>
        <h1>Lead Distribution Portal</h1>
        <p>v1.0 · Internal</p>
      </div>

      {/* <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        end>
        <span className="nav-icon">📊</span>
        Dashboard
      </NavLink> */}

      {/* <NavLink to="/submit" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="nav-icon">➕</span>
        Submit Lead
      </NavLink> */}

      <div className="ws-bar">
        <div className={`ws-dot ${wsConnected ? '' : 'offline'}`} />
        {wsConnected ? 'Live — real-time connected' : 'Reconnecting…'}
      </div>
    </nav>
  );
}

function AppShell() {
  const [wsConnected, setWsConnected] = useState(false);

  // Dummy handler so hook runs at app level for sidebar WS indicator
  const handleEvent = useCallback(() => {}, []);
  const { connected } = useLeadSocket({ onEvent: handleEvent });

  return (
    <div className="app-shell">
      <Sidebar wsConnected={connected} />
      <main className="main-content">
        <Routes>
          <Route path="/"       element={<Dashboard />} />
          <Route path="/submit" element={<LeadForm />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ThemeProvider>
  );
}

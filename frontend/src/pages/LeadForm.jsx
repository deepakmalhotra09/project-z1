import React, { useState } from 'react';
import { useTheme } from '../ThemeContext';

const API = process.env.REACT_APP_API_URL || 'https://project-z1-qyrr.vercel.app';

const BUDGETS = ['Under $10k', '$10k-$50k', 'Greater than $50k'];

function validate(form) {
  const errors = {};
  if (!form.first_name.trim()) errors.first_name = 'Required';
  if (!form.last_name.trim())  errors.last_name  = 'Required';
  if (!form.company.trim())    errors.company    = 'Required';
  if (!form.budget)            errors.budget     = 'Select a budget range';
  if (!form.email.trim()) {
    errors.email = 'Required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Enter a valid corporate email';
  }
  return errors;
}

export default function LeadForm() {
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', company: '', budget: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const { isDark, toggleTheme } = useTheme();

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);

    try {
      const res = await fetch(`${API}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Submission failed');
      showToast(`✓ Lead #${data.lead_id} received. HubSpot sync in progress.`);
      setForm({ first_name: '', last_name: '', email: '', company: '', budget: '' });
    } catch (err) {
      showToast(`✗ ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Submit a Lead</h2>
          <p>Fill in the prospective client details below. The lead will be synced to HubSpot automatically.</p>
        </div>
        <button className="theme-btn" onClick={toggleTheme} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          {isDark ? '☀️' : '🌙'}
        </button>
      </div>

      <div className="page-body">
        <div className="form-page">
          <div className="card">
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="first_name">First Name</label>
                  <input
                    id="first_name"
                    type="text"
                    placeholder="Jane"
                    value={form.first_name}
                    onChange={set('first_name')}
                  />
                  {errors.first_name && <div className="form-error">{errors.first_name}</div>}
                </div>
                <div className="form-group">
                  <label htmlFor="last_name">Last Name</label>
                  <input
                    id="last_name"
                    type="text"
                    placeholder="Doe"
                    value={form.last_name}
                    onChange={set('last_name')}
                  />
                  {errors.last_name && <div className="form-error">{errors.last_name}</div>}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="email">Corporate Email Address</label>
                <input
                  id="email"
                  type="email"
                  placeholder="jane@company.com"
                  value={form.email}
                  onChange={set('email')}
                />
                {errors.email && <div className="form-error">{errors.email}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="company">Company Name</label>
                <input
                  id="company"
                  type="text"
                  placeholder="Acme Corporation"
                  value={form.company}
                  onChange={set('company')}
                />
                {errors.company && <div className="form-error">{errors.company}</div>}
              </div>

              <div className="form-group">
                <label htmlFor="budget">Estimated Annual Budget</label>
                <select id="budget" value={form.budget} onChange={set('budget')}>
                  <option value="">Select budget range…</option>
                  {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                {errors.budget && <div className="form-error">{errors.budget}</div>}
              </div>

              <button className="btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Lead →'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

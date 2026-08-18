import { useLocation } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import AppShell from '../components/AppShell';
import { RatingGauge, RatingScorePicker } from '../components/RatingGauge';
import {
  downloadRatingsCsv,
  downloadRatingsPdf,
  monthRange,
} from '../exportRatings';
import { formatDateTime, appYear, appToday, managerOptionLabel } from '../utils';

const PERIOD_MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

function defaultPeriod() {
  const today = appToday();
  return {
    month: String(today.getMonth() + 1),
    year: String(today.getFullYear()),
  };
}

function formatPeriodLabel(year, month) {
  const label = PERIOD_MONTHS.find((m) => m.value === String(month))?.label;
  return label ? `${label} ${year}` : '';
}

const MANAGER_NAV = [
  { to: '/manager', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/manager/approvals', label: 'Approvals', icon: '/assets/nav-approved.png' },
  { to: '/manager/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/manager/reports', label: 'Reports', icon: '/assets/document.png' },
  { to: '/manager/salary', label: 'Salary', icon: '/assets/nav-searchlist.png' },
  { to: '/manager/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/manager/history', label: 'History', icon: '/assets/nav-hourglass.png' },
];

const HR_NAV = [
  { to: '/hr', label: 'Overview', end: true, icon: '/assets/nav-searchlist.png' },
  { to: '/hr/approvals', label: 'HR approvals', icon: '/assets/nav-approved.png' },
  { to: '/hr/onboarding', label: 'Onboarding', icon: '/assets/nav-onboarding.png' },
  { to: '/hr/users', label: 'Leave Management', icon: '/assets/nav-team.png' },
  { to: '/hr/ratings', label: 'Ratings', icon: '/assets/rating-star.png' },
  { to: '/hr/reports', label: 'Reports', icon: '/assets/document.png' },
  { to: '/hr/invoices', label: 'Invoices', icon: '/assets/nav-searchlist.png' },
  { to: '/hr/calendar', label: 'Team calendar', icon: '/assets/nav-calendar.png' },
  { to: '/hr/history', label: 'History', icon: '/assets/nav-hourglass.png' },
];

const USER_NAV = [
  { to: '/app', label: 'Home', end: true },
  { to: '/app/apply', label: 'Apply' },
  { to: '/app/calendar', label: 'My calendar' },
  { to: '/app/salary', label: 'Salary' },
  { to: '/app/ratings', label: 'My ratings' },
  { to: '/app/history', label: 'History' },
];

const MONTHS = [
  { value: '', label: 'All months' },
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

function useEmployeeRatings() {
  const location = useLocation();
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    return api('/ratings')
      .then((d) => setRatings(d.ratings || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, location.pathname, location.key]);

  return { ratings, loading, error, reload };
}

function RatingCard({ rating, showEmployee = false, detailed = false }) {
  if (detailed) {
    return (
      <article className="rating-detail-card">
        <div className="rating-detail-top">
          <RatingGauge score={rating.score} />
          <dl className="rating-detail-fields">
            <div className="rating-detail-row">
              <dt>Manager</dt>
              <dd>{rating.managerName}</dd>
            </div>
            <div className="rating-detail-row">
              <dt>Period</dt>
              <dd>{rating.periodLabel || '—'}</dd>
            </div>
            <div className="rating-detail-row">
              <dt>Rated on</dt>
              <dd>{formatDateTime(rating.createdAt)}</dd>
            </div>
          </dl>
        </div>
        <div className="rating-detail-feedback">
          <h4>Feedback</h4>
          <p>{rating.feedback}</p>
        </div>
      </article>
    );
  }

  return (
    <article className="rating-card">
      <header className="rating-card-head">
        <div>
          {showEmployee && (
            <strong className="rating-employee">
              {rating.userName}
              {rating.employeeNumber ? ` · ${rating.employeeNumber}` : ''}
            </strong>
          )}
          <p className="muted rating-meta">
            {showEmployee ? `Rated by ${rating.managerName}` : `From ${rating.managerName}`}
            {' · '}
            {formatDateTime(rating.createdAt)}
            {rating.periodLabel ? ` · ${rating.periodLabel}` : ''}
          </p>
        </div>
        <RatingGauge score={rating.score} />
      </header>
      <p className="rating-feedback">{rating.feedback}</p>
    </article>
  );
}

function RateEmployeeModal({ employee, existingRatings = [], onClose, onSaved }) {
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [periodMonth, setPeriodMonth] = useState(() => defaultPeriod().month);
  const [periodYear, setPeriodYear] = useState(() => defaultPeriod().year);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const periodYears = useMemo(() => {
    const y = appYear();
    return Array.from({ length: 4 }, (_, i) => String(y - i));
  }, []);

  const periodLabel = formatPeriodLabel(periodYear, periodMonth);
  const duplicateRating = useMemo(
    () => existingRatings.find((r) => r.periodLabel === periodLabel),
    [existingRatings, periodLabel]
  );

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (duplicateRating) {
      setError(
        `A rating for ${periodLabel} has already been submitted for this employee.`
      );
      return;
    }
    if (!score) {
      setError('Please select a rating from 1 to 10.');
      return;
    }
    if (feedback.trim().length < 10) {
      setError('Feedback is required (at least 10 characters).');
      return;
    }
    setBusy(true);
    try {
      await api('/ratings', {
        method: 'POST',
        body: {
          userId: employee.id,
          score,
          feedback: feedback.trim(),
          periodLabel: formatPeriodLabel(periodYear, periodMonth),
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const formError =
    error ||
    (duplicateRating
      ? `A rating for ${periodLabel} has already been submitted for this employee.`
      : '');

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal rating-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2>Rate {employee.name}</h2>
        {employee.employeeNumber && (
          <p className="muted">Employee #{employee.employeeNumber}</p>
        )}
        <form onSubmit={submit} className="stack">
          <RatingScorePicker value={score} onChange={setScore} />
          <div className="period-select">
            <span className="period-select-label">Period</span>
            <div className="period-select-row">
              <label>
                Month
                <select
                  value={periodMonth}
                  onChange={(e) => setPeriodMonth(e.target.value)}
                  required
                >
                  {PERIOD_MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Year
                <select
                  value={periodYear}
                  onChange={(e) => setPeriodYear(e.target.value)}
                  required
                >
                  {periodYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <label>
            Feedback <span className="required">*</span>
            <textarea
              rows={5}
              required
              minLength={10}
              placeholder="Share specific feedback for this employee…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          {formError && <p className="form-error">{formError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || Boolean(duplicateRating)}
            >
              {busy ? 'Saving…' : 'Submit rating'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function matchesPeriodLabel(periodLabel, year, month) {
  if (!year && !month) return true;
  if (!periodLabel) return false;
  if (year && month) {
    const label = PERIOD_MONTHS.find((m) => m.value === String(month))?.label;
    return periodLabel === `${label} ${year}`;
  }
  if (year) return periodLabel.endsWith(` ${year}`);
  return true;
}

export function EmployeeRatingsSection() {
  const { ratings, loading, error } = useEmployeeRatings();
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');

  const years = useMemo(() => {
    const y = appYear();
    return Array.from({ length: 6 }, (_, i) => String(y - i));
  }, []);

  useEffect(() => {
    if (!year) setMonth('');
  }, [year]);

  const filtered = useMemo(
    () => ratings.filter((r) => matchesPeriodLabel(r.periodLabel, year, month)),
    [ratings, year, month]
  );

  const avg =
    filtered.length > 0
      ? (filtered.reduce((s, r) => s + r.score, 0) / filtered.length).toFixed(1)
      : null;

  const filterSummary = useMemo(() => {
    if (!year) return 'All months';
    const monthLabel = MONTHS.find((m) => m.value === month)?.label;
    return month ? `${monthLabel} ${year}` : `Year ${year}`;
  }, [year, month]);

  function clearFilters() {
    setYear('');
    setMonth('');
  }

  const hasFilters = Boolean(year || month);

  return (
    <section className="panel employee-ratings-section">
      <header className="employee-ratings-header">
        <div>
          <h2>My performance ratings</h2>
          <p className="muted">
            All ratings from your managers — score, period, date, and full feedback.
          </p>
        </div>
        {avg && (
          <div className="employee-ratings-avg">
            <span className="muted">Average (filtered)</span>
            <RatingGauge score={avg} size="sm" />
          </div>
        )}
      </header>

      <div className="export-filters employee-ratings-filters employee-ratings-filters-simple">
        <label>
          Year
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label>
          Month
          <select value={month} onChange={(e) => setMonth(e.target.value)} disabled={!year}>
            {MONTHS.map((m) => (
              <option key={m.value || 'all'} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="employee-ratings-toolbar">
        <p className="muted small">{filterSummary}</p>
        <p className="muted small">
          Showing {filtered.length} of {ratings.length} rating{ratings.length === 1 ? '' : 's'}
        </p>
        {hasFilters && (
          <button type="button" className="btn ghost" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {loading && <p className="muted">Loading ratings…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <div className="empty-state">
          <p>
            {ratings.length === 0
              ? 'No ratings yet. Your manager will share feedback here when available.'
              : 'No ratings match the selected month and year.'}
          </p>
        </div>
      )}
      {filtered.length > 0 && (
        <div className="rating-list">
          {filtered.map((r) => (
            <RatingCard key={r.id} rating={r} detailed />
          ))}
        </div>
      )}
    </section>
  );
}

export function UserRatings() {
  return (
    <AppShell title="My ratings" nav={USER_NAV}>
      <EmployeeRatingsSection />
    </AppShell>
  );
}

export function ManagerRatings() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pick, setPick] = useState(null);
  const [search, setSearch] = useState('');

  function reload() {
    setLoading(true);
    setError('');
    Promise.all([api('/ratings/employees'), api('/ratings')])
      .then(([emp, rat]) => {
        setEmployees(emp.employees || []);
        setRatings(rat.ratings || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.email || '').toLowerCase().includes(q) ||
        (e.employeeNumber || '').toLowerCase().includes(q)
    );
  }, [employees, search]);

  return (
    <AppShell title={`Rate employees · ${user?.name || ''}`} nav={MANAGER_NAV}>
      <section className="panel">
        <h2>Rate an employee</h2>
        <p className="muted">
          Select any active employee, give a score from 1–10, and provide written feedback (required).
        </p>
        <input
          type="search"
          className="search-input"
          placeholder="Search by name, email, or employee number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {loading && <p className="muted">Loading…</p>}
        {error && <p className="form-error">{error}</p>}
        {!loading && (
          <div className="employee-rate-grid">
            {filtered.map((emp) => (
              <div key={emp.id} className="employee-rate-card">
                <div>
                  <strong>{emp.name}</strong>
                  {emp.employeeNumber && (
                    <span className="muted"> · #{emp.employeeNumber}</span>
                  )}
                  <p className="muted small">{emp.email}</p>
                </div>
                <button type="button" className="btn review-manager" onClick={() => setPick(emp)}>
                  Rate
                </button>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="muted">No employees match your search.</p>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Ratings you submitted</h2>
        {ratings.length === 0 ? (
          <p className="muted">You have not submitted any ratings yet.</p>
        ) : (
          <div className="rating-list">
            {ratings.map((r) => (
              <RatingCard key={r.id} rating={r} showEmployee />
            ))}
          </div>
        )}
      </section>

      {pick && (
        <RateEmployeeModal
          employee={pick}
          existingRatings={ratings.filter((r) => r.userId === pick.id)}
          onClose={() => setPick(null)}
          onSaved={reload}
        />
      )}
    </AppShell>
  );
}

export function HrRatings() {
  const { user } = useAuth();
  const [ratings, setRatings] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [managers, setManagers] = useState([]);
  const [userId, setUserId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [year, setYear] = useState(String(appYear()));
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState('');

  const years = useMemo(() => {
    const y = appYear();
    return Array.from({ length: 6 }, (_, i) => String(y - i));
  }, []);

  useEffect(() => {
    Promise.all([api('/ratings/employees'), api('/managers')])
      .then(([emp, mgrRes]) => {
        setEmployees(emp.employees || []);
        setManagers(mgrRes.managers || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (managerId) params.set('managerId', managerId);
    const { from, to } = monthRange(year, month);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    api(`/ratings?${params.toString()}`)
      .then((d) => setRatings(d.ratings || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [userId, managerId, year, month]);

  const filterSummary = useMemo(() => {
    const parts = [];
    const emp = employees.find((u) => String(u.id) === String(userId));
    parts.push(emp ? emp.name : 'All employees');
    const mgr = managers.find((u) => String(u.id) === String(managerId));
    parts.push(mgr ? `Manager: ${mgr.name}` : 'All managers');
    if (year) {
      const monthLabel = MONTHS.find((m) => m.value === month)?.label;
      parts.push(month ? `${monthLabel} ${year}` : `Year ${year}`);
    } else {
      parts.push('All dates');
    }
    return parts.join(' · ');
  }, [employees, managers, userId, managerId, year, month]);

  async function handleDownload(format) {
    setBusy(true);
    setExportError('');
    try {
      const stamp = [year || 'all', month || 'all', userId || 'all-emp', managerId || 'all-mgr'].join(
        '_'
      );
      const base = `ultrix-ratings_${stamp}`;
      if (format === 'csv') {
        downloadRatingsCsv(ratings, `${base}.csv`);
      } else {
        downloadRatingsPdf(
          ratings,
          {
            title: 'Ultrix Leave Portal — Employee ratings',
            subtitle: filterSummary,
          },
          `${base}.pdf`
        );
      }
    } catch (err) {
      setExportError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title={`Employee ratings · ${user?.name || ''}`} nav={HR_NAV}>
      <section className="panel">
        <h2>All employee ratings</h2>
        <p className="muted">View ratings submitted by managers. Filter and export as CSV or PDF.</p>
        <div className="export-filters">
          <label>
            Employee
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Manager
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">All managers & HR</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {managerOptionLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label>
            Month
            <select value={month} onChange={(e) => setMonth(e.target.value)} disabled={!year}>
              {MONTHS.map((m) => (
                <option key={m.value || 'all'} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">{filterSummary}</p>
        <div className="export-actions">
          <button
            type="button"
            className={`download-icon-btn ${busy ? 'is-busy' : ''}`}
            disabled={busy || loading}
            onClick={() => handleDownload('csv')}
            aria-label="Download CSV"
            title="Download CSV"
          >
            <img src="/assets/document.png" alt="" />
            <span className="download-icon-tip">Download CSV</span>
          </button>
          <button
            type="button"
            className={`download-icon-btn ${busy ? 'is-busy' : ''}`}
            disabled={busy || loading}
            onClick={() => handleDownload('pdf')}
            aria-label="Download PDF"
            title="Download PDF"
          >
            <img src="/assets/download-pdf.png" alt="" />
            <span className="download-icon-tip">Download PDF</span>
          </button>
        </div>
        {exportError && <p className="form-error">{exportError}</p>}
      </section>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && !error && ratings.length === 0 && (
        <section className="panel empty-state">
          <p>No ratings match the selected filters.</p>
        </section>
      )}
      <div className="rating-list">
        {ratings.map((r) => (
          <RatingCard key={r.id} rating={r} showEmployee />
        ))}
      </div>
    </AppShell>
  );
}

export { MANAGER_NAV as MANAGER_RATINGS_NAV, HR_NAV as HR_RATINGS_NAV, USER_NAV as USER_RATINGS_NAV };

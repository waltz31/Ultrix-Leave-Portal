import { useMemo, useState } from 'react';
import { EMPLOYMENT_STATUS_OPTIONS } from './EmployeeOnboardingForm';
import { ROLE_LABELS, avatarSrc, formatDate } from '../utils';

function statusMeta(profile) {
  if (!profile?.active) {
    return { label: 'Inactive', tone: 'inactive' };
  }
  const value = profile.employment?.employmentStatus || 'active';
  const match = EMPLOYMENT_STATUS_OPTIONS.find((option) => option.value === value);
  if (value === 'notice_period') return { label: match?.label || 'Notice', tone: 'notice' };
  if (value === 'resigned' || value === 'terminated') {
    return { label: match?.label || value, tone: 'inactive' };
  }
  return { label: match?.label || 'Active', tone: 'active' };
}

function barcodeBars(code) {
  const text = String(code || 'ULTRIX');
  return Array.from({ length: 22 }, (_, index) => {
    const codePoint = text.charCodeAt(index % text.length);
    return (codePoint % 4) + 1;
  });
}

function holderSign(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

export default function OnboardingIdCard({
  profile,
  managerName,
  selected = false,
  menu = null,
}) {
  const [flipped, setFlipped] = useState(false);
  const personal = profile.personal || {};
  const employment = profile.employment || {};
  const status = statusMeta(profile);
  const empNo = profile.employeeNumber || '—';
  const bars = useMemo(() => barcodeBars(empNo), [empNo]);

  function flipCard(event) {
    if (event.target.closest('.profile-card-menu, .id-badge-flip-btn')) return;
    setFlipped((value) => !value);
  }

  return (
    <div className={`id-badge-wrap${selected ? ' is-selected' : ''}`}>
      {menu}
      <article
        className={`id-badge-scene${flipped ? ' is-flipped' : ''}`}
        onClick={flipCard}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setFlipped((value) => !value);
          }
        }}
        aria-label={`${profile.name || 'Employee'} ID card. Click to flip.`}
      >
      <div className="id-badge-inner">
        <div className="id-badge-face id-badge-front">
          <div className="id-badge-sheen" aria-hidden />
          <header className="id-badge-header">
            <div className="id-badge-brand">
              <span className="id-badge-mark" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span>Ultrix</span>
            </div>
            <span className={`id-badge-level is-${status.tone}`}>{status.label}</span>
          </header>

          <div className="id-badge-body">
            <div className="id-badge-photo-wrap">
              <div className="id-badge-photo-ring">
                <img src={avatarSrc(personal.profilePhoto)} alt="" />
              </div>
              <span
                className={`id-badge-live ${profile.active ? 'is-on' : 'is-off'}`}
                title={profile.active ? 'Active' : 'Inactive'}
              />
            </div>
            <h3>{profile.name || 'Unnamed'}</h3>
            <p className="id-badge-role">{employment.designation || ROLE_LABELS[profile.role] || 'Employee'}</p>
            <p className="id-badge-dept">{employment.department || '—'}</p>
          </div>

          <footer className="id-badge-meta">
            <div>
              <span>Employee no.</span>
              <strong className="id-badge-mono">{empNo}</strong>
            </div>
            <div>
              <span>Joined</span>
              <strong>{employment.dateOfJoining ? formatDate(employment.dateOfJoining) : '—'}</strong>
            </div>
            <div className="id-badge-chip" aria-hidden>
              <i />
              <i />
              <i />
            </div>
          </footer>
        </div>

        <div className="id-badge-face id-badge-back">
          <div className="id-badge-mag">Ultrix identity · keep this badge with you at work</div>
          <div className="id-badge-back-copy">
            <h4>Personal details</h4>
            <dl>
              <div>
                <dt>Work email</dt>
                <dd>{profile.email || '—'}</dd>
              </div>
              <div>
                <dt>Mobile</dt>
                <dd>{personal.personalMobile || '—'}</dd>
              </div>
              <div>
                <dt>Date of birth</dt>
                <dd>{personal.dateOfBirth ? formatDate(personal.dateOfBirth) : '—'}</dd>
              </div>
              <div>
                <dt>Reports to</dt>
                <dd>{managerName || 'Unassigned'}</dd>
              </div>
            </dl>
          </div>
          <div className="id-badge-barcode">
            <div className="id-badge-bars" aria-hidden>
              {bars.map((width, index) => (
                <span key={index} style={{ width: `${width}px` }} />
              ))}
            </div>
            <span className="id-badge-mono">{empNo}</span>
          </div>
          <footer className="id-badge-back-foot">
            <div>
              <span>Portal role</span>
              <strong>{ROLE_LABELS[profile.role] || profile.role}</strong>
            </div>
            <div className="id-badge-sign">
              <em>{holderSign(profile.name)}</em>
              <span>Employee</span>
            </div>
          </footer>
        </div>
      </div>
      </article>
      <p className="id-badge-hint">Click to flip</p>
    </div>
  );
}

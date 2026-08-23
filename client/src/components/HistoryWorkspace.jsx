import { useState } from 'react';

function LeaveHistoryIcon() {
  return (
    <svg className="history-tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 3.5h6.2L18.5 8v12.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 3.8V8h4.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="14.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 13.2V14.5l1.2.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function RegularizationHistoryIcon() {
  return (
    <svg className="history-tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="4"
        y="5"
        width="16"
        height="15"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M8 3.5v3M16 3.5v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="15.2" cy="16.2" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15.2 14.8V16.2l1.1.7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function HistoryWorkspace({ leave, regularization }) {
  const [tab, setTab] = useState('leave');

  return (
    <div className="history-layout">
      <nav className="history-side-tabs" aria-label="History sections">
        <button
          type="button"
          className={`history-side-tab${tab === 'leave' ? ' is-active' : ''}`}
          onClick={() => setTab('leave')}
        >
          <LeaveHistoryIcon />
          <span className="history-tab-divider" />
          Leave
        </button>
        <button
          type="button"
          className={`history-side-tab${tab === 'regularization' ? ' is-active' : ''}`}
          onClick={() => setTab('regularization')}
        >
          <RegularizationHistoryIcon />
          <span className="history-tab-divider" />
          Regularization
        </button>
      </nav>
      <div className="history-side-panel">
        {tab === 'leave' ? leave : regularization}
      </div>
    </div>
  );
}

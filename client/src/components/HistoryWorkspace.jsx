import { useState } from 'react';

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
          Leave history
        </button>
        <button
          type="button"
          className={`history-side-tab${tab === 'regularization' ? ' is-active' : ''}`}
          onClick={() => setTab('regularization')}
        >
          Regularization history
        </button>
      </nav>
      <div className="history-side-panel">
        {tab === 'leave' ? leave : regularization}
      </div>
    </div>
  );
}

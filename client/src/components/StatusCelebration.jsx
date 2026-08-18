import { useEffect } from 'react';

export default function StatusCelebration({
  show,
  onDone,
  message = 'Done!',
  imageSrc = '/assets/leave-approved.gif',
  detail = '',
  credentials = null,
  durationMs = 3000,
}) {
  useEffect(() => {
    if (!show) return undefined;
    const timer = setTimeout(() => onDone?.(), durationMs);
    return () => clearTimeout(timer);
  }, [show, onDone, durationMs]);

  if (!show) return null;

  return (
    <div className="approved-celebration" role="status" aria-live="polite">
      <div className="approved-celebration-card">
        <img
          key={show ? imageSrc : 'hidden'}
          src={imageSrc}
          alt=""
          className="approved-celebration-gif"
        />
        <strong>{message}</strong>
        {detail ? <p className="approved-celebration-detail">{detail}</p> : null}
        {credentials?.email ? (
          <div className="credential-box">
            <div>
              <span className="credential-label">Login email</span>
              <code>{credentials.email}</code>
              {credentials.emailGenerated ? (
                <span className="credential-note">auto-generated</span>
              ) : null}
            </div>
            {credentials.password ? (
              <div>
                <span className="credential-label">Temporary password</span>
                <code>{credentials.password}</code>
                {credentials.passwordGenerated ? (
                  <span className="credential-note">auto-generated — copy now</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

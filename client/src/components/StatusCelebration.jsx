import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function StatusCelebration({
  show,
  onDone,
  message = 'Done!',
  imageSrc = '/assets/leave-approved.gif',
  detail = '',
  credentials = null,
  durationMs = 3000,
}) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!show) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => onDoneRef.current?.(), durationMs);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
    };
  }, [show, durationMs]);

  if (!show) return null;

  return createPortal(
    <div className="approved-celebration" role="status" aria-live="polite">
      <div className="approved-celebration-card">
        <img src={imageSrc} alt="" className="approved-celebration-gif" />
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
    </div>,
    document.body
  );
}

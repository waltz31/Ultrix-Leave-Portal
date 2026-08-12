import { useEffect } from 'react';

export default function StatusCelebration({
  show,
  onDone,
  message = 'Done!',
  imageSrc = '/assets/leave-approved.gif',
  detail = '',
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
      </div>
    </div>
  );
}

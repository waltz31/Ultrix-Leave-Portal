export default function ErrorPopup({
  show,
  title = 'Cannot apply leave',
  message,
  onClose,
}) {
  if (!show) return null;

  return (
    <div className="modal-backdrop error-popup-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal error-popup"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-popup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="error-popup-title">{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

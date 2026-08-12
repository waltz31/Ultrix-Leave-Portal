import StatusCelebration from './StatusCelebration';

export default function ApprovedCelebration({
  show,
  onDone,
  message = 'Leave approved!',
  detail = '',
  imageSrc = '/assets/leave-approved.gif',
  durationMs = 2800,
}) {
  return (
    <StatusCelebration
      show={show}
      onDone={onDone}
      message={message}
      detail={detail}
      imageSrc={imageSrc}
      durationMs={durationMs}
    />
  );
}

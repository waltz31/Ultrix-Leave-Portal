import { useEffect, useRef, useState } from 'react';

export const RATING_MAX = 10;

const TONE_META = {
  red:    { color: '#ff7b8a', bg: 'rgba(255,123,138,0.18)', glow: '0 0 16px rgba(255,123,138,0.55)' },
  yellow: { color: '#f5c842', bg: 'rgba(245,200,66,0.18)',  glow: '0 0 16px rgba(245,200,66,0.5)' },
  orange: { color: '#ffb347', bg: 'rgba(255,179,71,0.18)',  glow: '0 0 16px rgba(255,179,71,0.5)' },
  green:  { color: '#5fd68a', bg: 'rgba(95,214,138,0.18)',  glow: '0 0 16px rgba(95,214,138,0.5)' },
  ultrix: { color: '#64c5c1', bg: 'rgba(100,197,193,0.18)', glow: '0 0 20px rgba(181,163,237,0.65)' },
};

const TONE_LABELS_BY_SCORE = {
  1: 'Terrible', 2: 'Very poor', 3: 'Poor',
  4: 'Below average', 5: 'Average',
  6: 'Okay', 7: 'Good',
  8: 'Great',
  9: 'Excellent', 10: 'Outstanding',
};

export const RATING_STAR_ICON = '/assets/rating-star.png';

export function scoreTone(score) {
  const n = Math.round(Number(score) || 0);
  if (n >= 9) return 'ultrix';
  if (n === 8) return 'green';
  if (n >= 6) return 'orange';
  if (n >= 4) return 'yellow';
  return 'red';
}

function useAnimatedNumber(target, duration = 700, enabled = true) {
  const [display, setDisplay] = useState(enabled ? 0 : Number(target) || 0);

  useEffect(() => {
    const to = Number(target) || 0;
    if (!enabled) { setDisplay(to); return undefined; }
    if (to === 0) { setDisplay(0); return undefined; }

    const start = performance.now();
    let raf;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(to * eased * 10) / 10);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, enabled]);

  return display;
}

export function RatingGauge({ score, size = 'md', animate = true, showLabel = true }) {
  const numeric = Math.min(RATING_MAX, Math.max(0, Number(score) || 0));
  const animated = useAnimatedNumber(numeric, 750, animate);
  const filled = Math.round(animated || numeric);
  const tone = scoreTone(numeric);
  const pct = (animated / RATING_MAX) * 100;
  const displayScore = numeric > 0 ? Math.round(animated || numeric) : '—';

  return (
    <div
      className={`rating-gauge rating-gauge-${size} rating-tone-${tone}${animate ? ' rating-gauge-animate' : ''}`}
      aria-label={`${numeric} out of ${RATING_MAX}`}
    >
      <div className="rating-gauge-top">
        <div className="rating-gauge-number">
          <span className="rating-gauge-value">{displayScore}</span>
          {showLabel && <span className="rating-gauge-max">/{RATING_MAX}</span>}
        </div>
        <div className="rating-gauge-ring" style={{ '--pct': `${pct}%` }}>
          <svg viewBox="0 0 44 44" aria-hidden>
            <circle className="ring-track" cx="22" cy="22" r="18" />
            <circle className="ring-fill" cx="22" cy="22" r="18" />
          </svg>
        </div>
      </div>
      <div className="rating-segments" aria-hidden>
        {Array.from({ length: RATING_MAX }, (_, i) => (
          <span
            key={i}
            className={`rating-segment${i < filled ? ' filled' : ''}`}
            style={{ '--i': i }}
          />
        ))}
      </div>
    </div>
  );
}

export function RatingScorePicker({ value, onChange }) {
  const selected = Number(value) || 0;
  const [ripple, setRipple] = useState(null);
  const timerRef = useRef(null);

  const tone = selected ? scoreTone(selected) : null;
  const meta = tone ? TONE_META[tone] : null;
  const toneLabel = selected ? TONE_LABELS_BY_SCORE[selected] : null;

  function handleClick(n, e) {
    onChange(n);
    const rect = e.currentTarget.getBoundingClientRect();
    setRipple({ n, x: e.clientX - rect.left, y: e.clientY - rect.top });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setRipple(null), 600);
  }

  return (
    <div className="rating-picker">
      <div className="rating-picker-header">
        <label className="rating-picker-label">
          <img
            className="rating-picker-star"
            src={RATING_STAR_ICON}
            alt=""
            aria-hidden
          />
          Rating (1–{RATING_MAX})
        </label>
        <div className={`rating-picker-tone${toneLabel ? ' visible' : ''}`}>
          <span
            className={`rating-tone-badge${toneLabel ? ' visible' : ''}`}
            style={
              toneLabel
                ? { color: meta.color, borderColor: meta.color, background: meta.bg }
                : undefined
            }
            aria-hidden={!toneLabel}
          >
            {toneLabel || '\u00a0'}
          </span>
        </div>
      </div>

      {selected > 0 && (
        <div className="rating-picker-preview">
          <RatingGauge score={selected} size="sm" animate={false} />
        </div>
      )}

      <div className="rating-picker-grid">
        {Array.from({ length: RATING_MAX }, (_, i) => {
          const n = i + 1;
          const btnTone = scoreTone(n);
          const btnMeta = TONE_META[btnTone];
          const isActive = selected === n;
          const isLit = selected > 0 && n <= selected;
          const hasRipple = ripple?.n === n;

          return (
            <button
              key={n}
              type="button"
              className={`rating-pick rating-pick-${btnTone}${isActive ? ' active' : ''}${isLit && !isActive ? ' lit' : ''}`}
              onClick={(e) => handleClick(n, e)}
              aria-label={`${TONE_LABELS_BY_SCORE[n]} — ${n} out of ${RATING_MAX}`}
              data-label={TONE_LABELS_BY_SCORE[n]}
              style={{
                '--tone-color': btnMeta.color,
                '--tone-bg': btnMeta.bg,
                '--tone-glow': btnMeta.glow,
              }}
            >
              <span className="rating-pick-num">{n}</span>
              {hasRipple && (
                <span
                  className="rating-pick-ripple"
                  style={{ '--rx': `${ripple.x}px`, '--ry': `${ripple.y}px` }}
                />
              )}
            </button>
          );
        })}
      </div>

      <p className="rating-picker-hint muted">
        {selected > 0
          ? `${TONE_LABELS_BY_SCORE[selected]} · ${selected}/${RATING_MAX}`
          : 'Hover a number to see its label'}
      </p>
    </div>
  );
}

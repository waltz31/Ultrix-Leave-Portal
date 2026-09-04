import { useEffect, useRef, useState } from 'react';

/** Mount children only after they enter (near) the viewport — defers heavy post-login work. */
export default function LazySection({
  children,
  placeholder = null,
  rootMargin = '240px',
  minDelayMs = 0,
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [delayDone, setDelayDone] = useState(minDelayMs <= 0);

  useEffect(() => {
    if (minDelayMs <= 0) return undefined;
    const timer = window.setTimeout(() => setDelayDone(true), minDelayMs);
    return () => window.clearTimeout(timer);
  }, [minDelayMs]);

  useEffect(() => {
    if (!delayDone || visible) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delayDone, rootMargin, visible]);

  return <div ref={ref}>{visible ? children : placeholder}</div>;
}

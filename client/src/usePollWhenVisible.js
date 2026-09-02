import { useEffect } from 'react';

/** Poll callback while tab is visible. Set leading=false to skip the immediate first call. */
export function usePollWhenVisible(callback, intervalMs, deps = [], { leading = true } = {}) {
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      if (document.visibilityState === 'visible') callback();
    };
    if (leading) tick();
    timer = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, callback, leading, ...deps]);
}

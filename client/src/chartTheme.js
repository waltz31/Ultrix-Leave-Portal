import { useMemo } from 'react';
import { useTheme } from './theme';

function hexToRgb(hex) {
  const raw = String(hex || '').replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function mixHex(a, b, ratio = 0.5) {
  const c1 = hexToRgb(a);
  const c2 = hexToRgb(b);
  const t = Math.min(1, Math.max(0, ratio));
  const mix = (x, y) => Math.round(x * (1 - t) + y * t);
  return `#${[mix(c1.r, c2.r), mix(c1.g, c2.g), mix(c1.b, c2.b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function useChartTheme() {
  const { primary, secondary, mode } = useTheme();

  return useMemo(() => {
    const light = mode === 'light';
    const gridStroke = light ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.18)';
    const tooltipStyle = {
      background: light ? 'rgba(255, 255, 255, 0.98)' : 'rgba(20, 30, 48, 0.95)',
      border: light ? '1px solid rgba(0, 0, 0, 0.12)' : '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: 10,
      color: light ? '#000000' : '#ffffff',
    };
    const tick = { fill: 'currentColor', fontSize: 11 };
    const attendance = {
      present: primary,
      absent: mixHex(primary, '#ef4444', 0.42),
      leave: secondary,
      late: mixHex(secondary, '#f97316', 0.38),
      wfh: mixHex(primary, secondary, 0.48),
    };
    const leaveType = {
      casual: mixHex(primary, '#38bdf8', 0.38),
      earned: primary,
      sick: secondary,
      restricted: mixHex(secondary, '#f43f5e', 0.42),
      wfh: mixHex(primary, '#fbbf24', 0.45),
    };
    const series = [
      primary,
      secondary,
      mixHex(primary, secondary, 0.35),
      mixHex(secondary, primary, 0.35),
      mixHex(primary, '#ffffff', 0.25),
    ];

    return {
      mode,
      primary,
      secondary,
      gridStroke,
      tooltipStyle,
      tick,
      attendance,
      leaveType,
      barGrad: [primary, secondary],
      seriesColor: (i) => series[i % series.length],
      leaveTypeColor: (type) => leaveType[type] || primary,
      attendanceColor: (key) => attendance[key] || primary,
    };
  }, [primary, secondary, mode]);
}

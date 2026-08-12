import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ultrix_theme_bg';
const DEFAULT_BG = '#0b1220';

const ThemeContext = createContext(null);

function hexToRgb(hex) {
  const raw = hex.replace('#', '');
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

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const toLin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

export function isLightColor(hex) {
  try {
    return luminance(hex) > 0.55;
  } catch {
    return false;
  }
}

function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const THEME_PRESETS = [
  { label: 'Default', value: DEFAULT_BG },
  { label: 'Ocean', value: '#0d3b66' },
  { label: 'Teal', value: '#0f766e' },
  { label: 'Plum', value: '#3b0764' },
  { label: 'Slate', value: '#334155' },
  { label: 'Sand', value: '#f3e8d8' },
  { label: 'Sky', value: '#e0f2fe' },
  { label: 'Mint', value: '#d1fae5' },
];

export function ThemeProvider({ children }) {
  const [bgColor, setBgColorState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_BG;
    } catch {
      return DEFAULT_BG;
    }
  });

  function setBgColor(next) {
    const value = next || DEFAULT_BG;
    setBgColorState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore
    }
  }

  const mode = isLightColor(bgColor) ? 'light' : 'dark';

  const shellStyle = useMemo(
    () => ({
      '--shell-wash': withAlpha(bgColor, mode === 'light' ? 0.78 : 0.55),
      '--shell-wash-deep': withAlpha(bgColor, mode === 'light' ? 0.88 : 0.72),
      '--welcome-label': mode === 'light' ? 'rgba(21, 32, 51, 0.78)' : '#ffffff',
    }),
    [bgColor, mode]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  const value = {
    bgColor,
    setBgColor,
    resetTheme: () => setBgColor(DEFAULT_BG),
    mode,
    shellStyle,
    isDefault: bgColor.toLowerCase() === DEFAULT_BG,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme requires ThemeProvider');
  return ctx;
}

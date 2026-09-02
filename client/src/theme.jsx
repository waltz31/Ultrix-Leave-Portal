import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY_ID = 'ultrix_theme_id';
const STORAGE_KEY_BG = 'ultrix_theme_bg';
const DEFAULT_ID = 'ultrix';
const DEFAULT_BG = '#0b1220';
const DEFAULT_PRIMARY = '#64c5c1';
const DEFAULT_SECONDARY = '#b5a3ed';

const ThemeContext = createContext(null);

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

function darken(hex, amount = 0.16) {
  const { r, g, b } = hexToRgb(hex);
  const f = Math.max(0, 1 - amount);
  return `#${[r, g, b]
    .map((v) => Math.round(v * f)
      .toString(16)
      .padStart(2, '0'))
    .join('')}`;
}

export const THEME_PRESETS = [
  { id: 'white', label: 'White', mode: 'light', primary: '#2563EB', secondary: '#0EA5E9', bg: '#F1F5F9' },
  { id: 'paper', label: 'Paper', mode: 'light', primary: '#0F766E', secondary: '#64C5C1', bg: '#F4F7F5' },
  { id: 'sand', label: 'Sand', mode: 'light', primary: '#C2410C', secondary: '#F59E0B', bg: '#F3E8D8' },
  { id: 'blush', label: 'Blush', mode: 'light', primary: '#DB2777', secondary: '#F43F5E', bg: '#FDF2F8' },
  { id: 'sky', label: 'Sky', mode: 'light', primary: '#0284C7', secondary: '#38BDF8', bg: '#E0F2FE' },
  { id: 'mint', label: 'Mint', mode: 'light', primary: '#059669', secondary: '#34D399', bg: '#D1FAE5' },
  { id: 'ultrix', label: 'Ultrix', mode: 'dark', primary: DEFAULT_PRIMARY, secondary: DEFAULT_SECONDARY, bg: DEFAULT_BG },
  { id: 'indigo', label: 'Indigo', mode: 'dark', primary: '#6366F1', secondary: '#A855F7', bg: '#12102A' },
  { id: 'violet', label: 'Violet', mode: 'dark', primary: '#8B5CF6', secondary: '#D946EF', bg: '#1A1030' },
  { id: 'cyan', label: 'Cyan', mode: 'dark', primary: '#06B6D4', secondary: '#3B82F6', bg: '#082430' },
  { id: 'emerald', label: 'Emerald', mode: 'dark', primary: '#10B981', secondary: '#34D399', bg: '#07241C' },
  { id: 'rose', label: 'Rose', mode: 'dark', primary: '#F43F5E', secondary: '#FB7185', bg: '#2A1018' },
  { id: 'amber', label: 'Amber', mode: 'dark', primary: '#F59E0B', secondary: '#F97316', bg: '#27180A' },
  { id: 'fuchsia', label: 'Fuchsia', mode: 'dark', primary: '#D946EF', secondary: '#EC4899', bg: '#2A1028' },
  { id: 'ocean', label: 'Ocean', mode: 'dark', primary: '#38BDF8', secondary: '#22D3EE', bg: '#0D3B66' },
  { id: 'teal', label: 'Teal', mode: 'dark', primary: '#2DD4BF', secondary: '#14B8A6', bg: '#0F766E' },
  { id: 'plum', label: 'Plum', mode: 'dark', primary: '#C084FC', secondary: '#A855F7', bg: '#3B0764' },
  { id: 'midnight', label: 'Midnight', mode: 'dark', primary: '#3B82F6', secondary: '#6366F1', bg: '#0B1228' },
  { id: 'forest', label: 'Forest', mode: 'dark', primary: '#059669', secondary: '#14B8A6', bg: '#06251C' },
  { id: 'wine', label: 'Wine', mode: 'dark', primary: '#E11D48', secondary: '#A855F7', bg: '#2A0B18' },
  { id: 'graphite', label: 'Graphite', mode: 'dark', primary: '#94A3B8', secondary: '#64748B', bg: '#334155' },
];

const PRESET_BY_ID = new Map(THEME_PRESETS.map((p) => [p.id, p]));
const PRESET_BY_BG = new Map(THEME_PRESETS.map((p) => [p.bg.toLowerCase(), p]));

export const LIGHT_THEMES = THEME_PRESETS.filter((p) => p.mode === 'light');
export const DARK_THEMES = THEME_PRESETS.filter((p) => p.mode === 'dark');

function readStoredTheme() {
  try {
    const id = localStorage.getItem(STORAGE_KEY_ID);
    if (id && PRESET_BY_ID.has(id)) {
      const preset = PRESET_BY_ID.get(id);
      return { id: preset.id, bgColor: preset.bg };
    }
    if (id === 'custom') {
      const bg = localStorage.getItem(STORAGE_KEY_BG) || DEFAULT_BG;
      return { id: 'custom', bgColor: bg };
    }
    const oldBg = localStorage.getItem(STORAGE_KEY_BG);
    if (oldBg) {
      const match = PRESET_BY_BG.get(oldBg.toLowerCase());
      if (match) return { id: match.id, bgColor: match.bg };
      if (/^#[0-9a-fA-F]{6}$/.test(oldBg)) return { id: 'custom', bgColor: oldBg };
    }
  } catch {
    // ignore
  }
  return { id: DEFAULT_ID, bgColor: DEFAULT_BG };
}

function persistTheme(id, bgColor) {
  try {
    localStorage.setItem(STORAGE_KEY_ID, id);
    localStorage.setItem(STORAGE_KEY_BG, bgColor);
  } catch {
    // ignore
  }
}

function resolveTheme(id, bgColor) {
  const preset = PRESET_BY_ID.get(id);
  if (preset) {
    return {
      id: preset.id,
      label: preset.label,
      mode: preset.mode,
      primary: preset.primary,
      secondary: preset.secondary,
      bgColor: preset.bg,
    };
  }
  return {
    id: 'custom',
    label: 'Custom',
    mode: isLightColor(bgColor) ? 'light' : 'dark',
    primary: DEFAULT_PRIMARY,
    secondary: DEFAULT_SECONDARY,
    bgColor,
  };
}

export function ThemeProvider({ children }) {
  const initial = readStoredTheme();
  const [themeId, setThemeIdState] = useState(initial.id);
  const [bgColor, setBgColorState] = useState(initial.bgColor);

  const resolved = useMemo(() => resolveTheme(themeId, bgColor), [themeId, bgColor]);
  const { mode, primary, secondary } = resolved;

  function setThemeId(id) {
    const preset = PRESET_BY_ID.get(id);
    if (!preset) return;
    setThemeIdState(preset.id);
    setBgColorState(preset.bg);
    persistTheme(preset.id, preset.bg);
  }

  function setBgColor(next) {
    const value = next || DEFAULT_BG;
    const match = PRESET_BY_BG.get(value.toLowerCase());
    if (match) {
      setThemeId(match.id);
      return;
    }
    setThemeIdState('custom');
    setBgColorState(value);
    persistTheme('custom', value);
  }

  function resetTheme() {
    setThemeId(DEFAULT_ID);
  }

  const shellStyle = useMemo(() => {
    const wash = withAlpha(resolved.bgColor, mode === 'light' ? 0.78 : 0.55);
    const washDeep = withAlpha(resolved.bgColor, mode === 'light' ? 0.88 : 0.72);
    const brandDeep = darken(primary, 0.16);
    const text = mode === 'light' ? '#000000' : '#ffffff';
    const muted = mode === 'light' ? 'rgba(0, 0, 0, 0.72)' : 'rgba(255, 255, 255, 0.78)';
    const faint = mode === 'light' ? 'rgba(0, 0, 0, 0.58)' : 'rgba(255, 255, 255, 0.62)';
    return {
      '--shell-wash': wash,
      '--shell-wash-deep': washDeep,
      '--brand': primary,
      '--brand-2': secondary,
      '--brand-deep': brandDeep,
      '--brand-grad': `linear-gradient(90deg, ${primary}, ${secondary})`,
      '--accent': secondary,
      '--sidebar-badge': primary,
      /* High-contrast text: pure white/black by theme (not brand) */
      '--ink': text,
      '--muted': muted,
      '--fg': text,
      '--shell-fg': text,
      '--shell-strong': text,
      '--shell-panel-fg': text,
      '--shell-input-fg': text,
      '--shell-modal-fg': text,
      '--shell-popover-fg': text,
      '--shell-btn-ghost-fg': text,
      '--shell-badge-fg': text,
      '--shell-bell-fg': text,
      '--shell-muted': muted,
      '--shell-muted-soft': muted,
      '--shell-muted-faint': faint,
      '--shell-subtle': muted,
      '--shell-faint': faint,
      '--shell-th-fg': faint,
      '--shell-progress-label': muted,
      '--shell-progress-dot-fg': muted,
      '--shell-bell-muted': muted,
      '--welcome-label': text,
      '--sidebar-link': muted,
      '--sidebar-link-active': text,
      '--elb-fg': text,
      '--elb-muted': muted,
      '--elb-faint': faint,
      /* Keep semantic status colors independent of brand */
      '--ok': mode === 'light' ? '#16a34a' : '#4ade80',
      '--approved': mode === 'light' ? '#16a34a' : '#4ade80',
      '--pending': mode === 'light' ? '#d97706' : '#fbbf24',
      '--rejected': mode === 'light' ? '#dc2626' : '#f87171',
      '--danger': mode === 'light' ? '#dc2626' : '#f87171',
    };
  }, [resolved.bgColor, mode, primary, secondary]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.dataset.themeId = resolved.id;
    root.style.colorScheme = mode;
    Object.entries(shellStyle).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    document.body.style.background = resolved.bgColor;
  }, [mode, resolved.id, resolved.bgColor, shellStyle]);

  const value = {
    themeId: resolved.id,
    themeLabel: resolved.label,
    bgColor: resolved.bgColor,
    setBgColor,
    setThemeId,
    resetTheme,
    mode,
    primary,
    secondary,
    shellStyle,
    isDefault: resolved.id === DEFAULT_ID,
    isCustom: resolved.id === 'custom',
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme requires ThemeProvider');
  return ctx;
}

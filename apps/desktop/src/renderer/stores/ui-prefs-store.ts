import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
export type DiffStyle = 'unified' | 'split';

interface UiPrefs {
  theme: ThemePreference;
  density: Density;
  reduceMotion: boolean;
  diffStyle: DiffStyle;
  collapseContext: boolean;
}

interface UiPrefsState extends UiPrefs {
  resolvedTheme: ResolvedTheme;
  set: <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => void;
}

const STORAGE_KEY = 'pi-desktop.ui-prefs';

const DEFAULTS: UiPrefs = {
  theme: 'system',
  density: 'comfortable',
  reduceMotion: false,
  diffStyle: 'unified',
  collapseContext: true,
};

/**
 * Presentation preferences. These live in the renderer rather than behind IPC
 * on purpose: they need no privileged access, and nothing outside the window
 * reads them.
 */
function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      theme: parsed.theme ?? DEFAULTS.theme,
      density: parsed.density ?? DEFAULTS.density,
      reduceMotion: parsed.reduceMotion ?? DEFAULTS.reduceMotion,
      diffStyle: parsed.diffStyle ?? DEFAULTS.diffStyle,
      collapseContext: parsed.collapseContext ?? DEFAULTS.collapseContext,
    };
  } catch {
    return DEFAULTS;
  }
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme: ThemePreference): ResolvedTheme {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

/** Push the resolved values onto <html> so CSS can key off them. */
function applyToDocument(prefs: UiPrefs, resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.density = prefs.density;
  if (prefs.reduceMotion) root.dataset.motion = 'reduced';
  else delete root.dataset.motion;
}

const initial = load();
const initialResolved = resolve(initial.theme);

export const useUiPrefsStore = create<UiPrefsState>((set, get) => ({
  ...initial,
  resolvedTheme: initialResolved,
  set: (key, value) => {
    set({ [key]: value } as Partial<UiPrefsState>);
    const next = get();
    const prefs: UiPrefs = {
      theme: next.theme,
      density: next.density,
      reduceMotion: next.reduceMotion,
      diffStyle: next.diffStyle,
      collapseContext: next.collapseContext,
    };
    const resolved = resolve(prefs.theme);
    set({ resolvedTheme: resolved });
    applyToDocument(prefs, resolved);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable — preferences stay for this window only */
    }
  },
}));

/** Called once at startup, before React renders, to avoid a flash. */
export function initUiPrefs() {
  applyToDocument(initial, initialResolved);
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const state = useUiPrefsStore.getState();
    if (state.theme !== 'system') return;
    const resolved = resolve('system');
    useUiPrefsStore.setState({ resolvedTheme: resolved });
    document.documentElement.dataset.theme = resolved;
  });
}

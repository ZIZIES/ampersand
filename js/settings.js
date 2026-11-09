// user preferences, persisted in localStorage. import { settings, setSetting, onSetting }.

const KEY = 'chess.settings.v1';

export const THEMES = {
  coral:  { light: '#f2e6d9', dark: '#d0806a' },
  green:  { light: '#ebecd0', dark: '#739552' },
  brown:  { light: '#f0d9b5', dark: '#b58863' },
  blue:   { light: '#dee3e6', dark: '#8ca2ad' },
  slate:  { light: '#d3d8de', dark: '#6f7b8b' },
  purple: { light: '#e9e3f2', dark: '#8f7bb5' },
};

const DEFAULTS = {
  autoQueen: false,     // skip the promotion picker
  premoves: true,       // allow queuing a move on the opponent's turn (online)
  castleOnRook: false,  // "legacy castling": drop the king onto its own rook to castle
  showLegal: true,      // legal-move dots
  autoFlip: true,       // local games: turn the board toward whoever is to move
  animate: true,        // slide pieces
  coords: true,         // rank/file labels
  theme: 'coral',
  localTc: '10+0',      // time control for local games
  hostTc: '10+0',       // time control when hosting online
  botRating: 1200,
  botColor: 'w',        // 'w' | 'b' | 'random'
  botTc: 'none',
  evalBar: true,        // bot games: show who's winning
  setupDone: false,     // finished or skipped the first-visit setup
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();
const subs = new Set();

export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode etc */ }
  if (key === 'theme') applyTheme();
  subs.forEach((fn) => fn(key, value));
}

export function onSetting(fn) { subs.add(fn); }

export function applyTheme() {
  const t = THEMES[settings.theme] || THEMES.coral;
  document.documentElement.style.setProperty('--sq-light', t.light);
  document.documentElement.style.setProperty('--sq-dark', t.dark);
}

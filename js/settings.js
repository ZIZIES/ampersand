// user preferences, persisted in localStorage. import { settings, setSetting, onSetting }.

const KEY = 'chess.settings.v1';

// board themes. the colors (squares + a matching accent for buttons etc) live in style.css under
// [data-theme="name"]; index.html sets the saved one on <html> before the first paint.
export const THEMES = ['coral', 'green', 'brown', 'blue', 'slate', 'purple'];

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
  document.documentElement.dataset.theme = THEMES.includes(settings.theme) ? settings.theme : THEMES[0];
}

// forget everything saved. the caller reloads the page, which then starts like a first visit.
export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch { /* private mode etc */ }
}

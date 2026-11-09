// computer opponent + analysis engines.
//  rating < 1320  -> homemade beginner engine (js/beginner-worker.js)
//  1320 .. 3150   -> stockfish with UCI_LimitStrength at that elo
//  MAX_RATING     -> stockfish with no limits
import { Chess } from 'chess.js';
import { Engine, toWhite, winPct, uciToMove } from './engine.js';

export const MIN_RATING = 400;
export const MAX_RATING = 3200; // the slider's last notch = unlimited stockfish
const SF_MIN_ELO = 1320;        // lowest elo stockfish can limit itself to (from its source)

let botSf = null;
let analystSf = null;
let beginner = null;
let beginnerSeq = 0;
const beginnerWaiting = new Map();

export const botEngine = () => (botSf ||= new Engine());
export const analyst = () => (analystSf ||= new Engine());

function beginnerWorker() {
  if (!beginner) {
    beginner = new Worker(new URL('./beginner-worker.js', import.meta.url), { type: 'module' });
    beginner.onmessage = (e) => {
      const { id, move } = e.data;
      beginnerWaiting.get(id)?.(move);
      beginnerWaiting.delete(id);
    };
  }
  return beginner;
}

export function botName(rating) {
  return rating >= MAX_RATING ? 'stockfish max' : `bot ${rating}`;
}

export function describe(rating) {
  if (rating >= MAX_RATING) return 'full-strength stockfish';
  if (rating < 700) return 'beginner';
  if (rating < 1100) return 'casual';
  if (rating < 1500) return 'club player';
  if (rating < 1900) return 'strong club player';
  if (rating < 2300) return 'expert';
  if (rating < 2700) return 'master';
  return 'grandmaster+';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pick the bot's move. msLeft/inc = bot's clock (null when untimed)
export async function botMove(fen, rating, { msLeft = null, inc = 0 } = {}) {
  const started = performance.now();
  let move;
  if (rating < SF_MIN_ELO) {
    const id = ++beginnerSeq;
    move = await new Promise((resolve) => {
      beginnerWaiting.set(id, resolve);
      beginnerWorker().postMessage({ id, fen, rating });
    });
  } else {
    const max = rating >= MAX_RATING;
    let movetime = msLeft == null ? (max ? 1500 : 800) : msLeft / 30 + inc * 0.7;
    movetime = Math.round(Math.max(100, Math.min(max ? 5000 : 2500, movetime)));
    const res = await botEngine().search(fen, { movetime, elo: max ? null : rating, tag: 'bot' });
    move = uciToMove(res.bestmove);
  }
  // don't snap back instantly, it feels more like a person (skipped for max)
  if (rating < MAX_RATING) {
    let delay = 450 + Math.random() * 900;
    if (msLeft != null) delay = Math.min(delay, msLeft / 40);
    const wait = delay - (performance.now() - started);
    if (wait > 0) await sleep(wait);
  }
  return move;
}

export function stopBot() { botSf?.stop('bot'); }

// eval of a finished position (white's view), or null if the game isn't over
export function terminalScore(g) {
  if (g.isCheckmate()) return { type: 'mate', value: g.turn() === 'w' ? -0.5 : 0.5 }; // sign = who won
  if (g.isGameOver()) return { type: 'cp', value: 0 };
  return null;
}

// ---------- game review ----------

const CLASS_LIMITS = [['blunder', 15], ['mistake', 10], ['inaccuracy', 5]]; // win% lost

// analyse every position of a game. history = verbose moves from the start position.
export async function analyseGame(history, { onProgress, shouldStop, depth = 12, movetime = 400 } = {}) {
  const eng = analyst();
  const g = new Chess();
  const evals = [];
  const best = [];
  for (let i = 0; i <= history.length; i++) {
    if (shouldStop?.()) return null;
    if (i > 0) g.move(history[i - 1]);
    const term = terminalScore(g);
    if (term) {
      evals.push(term);
      best.push(null);
    } else {
      const r = await eng.search(g.fen(), { depth, movetime, tag: 'review' });
      evals.push(toWhite(r.score, g.turn()));
      best.push(r.bestmove);
    }
    onProgress?.(i + 1, history.length + 1);
  }

  const moves = history.map((mv, i) => {
    const before = winPct(evals[i]);
    const after = winPct(evals[i + 1]);
    const loss = Math.max(0, mv.color === 'w' ? before - after : after - before);
    const uci = mv.from + mv.to + (mv.promotion || '');
    let cls = best[i] === uci ? 'best' : 'good';
    for (const [name, limit] of CLASS_LIMITS) {
      if (cls !== 'best' && loss >= limit) { cls = name; break; }
    }
    const accuracy = Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
    return { san: mv.san, color: mv.color, cls, loss, accuracy, best: best[i] };
  });

  const summary = {};
  for (const c of ['w', 'b']) {
    const mine = moves.filter((m) => m.color === c);
    summary[c] = {
      accuracy: mine.length ? Math.round(mine.reduce((a, m) => a + m.accuracy, 0) / mine.length) : null,
      inaccuracy: mine.filter((m) => m.cls === 'inaccuracy').length,
      mistake: mine.filter((m) => m.cls === 'mistake').length,
      blunder: mine.filter((m) => m.cls === 'blunder').length,
    };
  }
  return { evals, best, moves, summary };
}

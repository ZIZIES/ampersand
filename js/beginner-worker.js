// homemade beginner bot, ~400-1300 rating. runs as a module worker.
// it plays like a beginner on purpose:
//  - low ratings look one move ahead only, so they grab "free" pieces without seeing the recapture
//  - mid ratings see your reply but not deeper exchanges
//  - every move's score gets random noise, then a weighted-random pick among the candidates
// message in: { id, fen, rating }   message out: { id, move: { from, to, promotion } | null }
import { Chess } from '../vendor/chess.js/chess.js'; // workers can't use the page's importmap

const VAL = { p: 100, n: 300, b: 315, r: 500, q: 900, k: 0 };
const MATE = 100_000;

// small positional nudges, built from simple rules rather than tables.
// f = file 0-7, r = rank 0-7 from the piece owner's side
const centrality = (f, r) => 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5)); // 0 edge .. 3 center
function nudge(type, f, r) {
  switch (type) {
    case 'p': return r * 5 + (f === 3 || f === 4 ? r * 4 : 0);
    case 'n': return centrality(f, r) * 10 - 12;
    case 'b': return centrality(f, r) * 5;
    case 'r': return r === 6 ? 15 : 0;
    case 'q': return centrality(f, r) * 2;
    case 'k': return r === 0 ? (f <= 2 || f >= 6 ? 15 : 0) : -r * 10;
    default: return 0;
  }
}

// static eval from the side to move's point of view
function evaluate(g) {
  let s = 0;
  const b = g.board();
  for (let row = 0; row < 8; row++) {
    for (let f = 0; f < 8; f++) {
      const p = b[row][f];
      if (!p) continue;
      const r = p.color === 'w' ? 7 - row : row;
      const v = VAL[p.type] + nudge(p.type, f, r);
      s += p.color === 'w' ? v : -v;
    }
  }
  return g.turn() === 'w' ? s : -s;
}

// captures first, biggest victim / smallest attacker first (makes alpha-beta prune more)
function ordered(moves) {
  return moves.sort((a, b) => score(b) - score(a));
  function score(m) {
    return (m.captured ? VAL[m.captured] * 10 - VAL[m.piece] : 0) + (m.promotion ? 800 : 0);
  }
}

function leaf(g, ply) {
  if (g.inCheck() && g.moves().length === 0) return -MATE + ply;
  return evaluate(g);
}

// only captures, so a search doesn't stop in the middle of a trade
function qsearch(g, alpha, beta, ply, left) {
  const stand = leaf(g, ply);
  if (stand <= -MATE + 1000 || left === 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const caps = ordered(g.moves({ verbose: true }).filter((m) => m.captured));
  for (const m of caps) {
    g.move(m);
    const s = -qsearch(g, -beta, -alpha, ply + 1, left - 1);
    g.undo();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function negamax(g, depth, alpha, beta, ply, quiesce) {
  if (depth === 0) return quiesce ? qsearch(g, alpha, beta, ply, 4) : leaf(g, ply);
  const moves = g.moves({ verbose: true });
  if (moves.length === 0) return g.inCheck() ? -MATE + ply : 0;
  for (const m of ordered(moves)) {
    g.move(m);
    const s = -negamax(g, depth - 1, -beta, -alpha, ply + 1, quiesce);
    g.undo();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function params(rating) {
  const t = Math.min(1, Math.max(0, (rating - 400) / 900)); // 0 at 400 .. 1 at 1300
  return {
    depth: rating < 650 ? 1 : 2,
    quiesce: rating >= 950,
    noise: 170 - 140 * t, // centipawns of random error per move
    temp: 90 - 72 * t,    // how loosely it picks among the candidates
  };
}

function gaussian() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick(fen, rating) {
  const g = new Chess(fen);
  const { depth, quiesce, noise, temp } = params(rating);
  const moves = g.moves({ verbose: true });
  if (!moves.length) return null;
  const scored = moves.map((m) => {
    g.move(m);
    let s = -negamax(g, depth - 1, -Infinity, Infinity, 1, quiesce);
    g.undo();
    if (Math.abs(s) < MATE - 1000) s += gaussian() * noise; // never "miss" a forced mate by noise
    return { m, s };
  });
  const best = Math.max(...scored.map((x) => x.s));
  const weights = scored.map((x) => Math.exp((x.s - best) / temp));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return scored[i].m;
  }
  return scored[0].m;
}

self.onmessage = (e) => {
  const { id, fen, rating } = e.data;
  let move = null;
  try {
    const m = pick(fen, rating);
    if (m) move = { from: m.from, to: m.to, promotion: m.promotion };
  } catch { /* leave null */ }
  self.postMessage({ id, move });
};

// stockfish 19 lite (single-threaded wasm, engine/ folder) in a web worker, spoken to over uci.
// searches run one at a time per engine; each has a tag so callers can stop only their own kind.

const ENGINE_URL = 'engine/stockfish-19-lite-single.js';

function parseInfo(line) {
  const t = line.split(' ');
  const o = {};
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') o.depth = Number(t[++i]);
    else if (k === 'multipv') o.multipv = Number(t[++i]);
    else if (k === 'score') {
      o.score = { type: t[++i], value: Number(t[++i]) };
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { o.bound = true; i++; }
    } else if (k === 'pv') { o.pv = t.slice(i + 1); break; }
  }
  return o;
}

export class Engine {
  constructor(url = ENGINE_URL) {
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.current = null; // { tag } of the running search
    this.worker = new Worker(url);
    this.ready = new Promise((resolve, reject) => {
      this.worker.onerror = (e) => reject(new Error('engine failed to load: ' + (e.message || 'unknown error')));
      this.worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : String(e.data);
        this.listeners.forEach((fn) => fn(line));
      };
      this.#waitFor((l) => l === 'uciok').then(() => {
        this.send('isready');
        return this.#waitFor((l) => l === 'readyok');
      }).then(resolve);
      this.send('uci');
    });
  }

  send(cmd) { this.worker.postMessage(cmd); }

  #waitFor(pred, onLine) {
    return new Promise((resolve) => {
      const fn = (line) => {
        onLine?.(line);
        if (pred(line)) { this.listeners.delete(fn); resolve(line); }
      };
      this.listeners.add(fn);
    });
  }

  // returns { bestmove: 'e2e4' | null, score: {type:'cp'|'mate', value} (side to move's view), pv, depth }
  // opts: movetime (ms), depth, elo (null = full strength), tag (for stop()), onInfo(info),
  //       skipIf(): checked when the search reaches the front of the queue; true = resolve null
  search(fen, opts = {}) {
    const job = this.queue.then(() => this.#run(fen, opts));
    this.queue = job.catch(() => {});
    return job;
  }

  async #run(fen, { movetime, depth, elo = null, tag = 'search', onInfo, skipIf } = {}) {
    await this.ready;
    if (skipIf?.()) return null;
    this.current = { tag };
    this.send(`setoption name UCI_LimitStrength value ${elo ? 'true' : 'false'}`);
    if (elo) this.send(`setoption name UCI_Elo value ${Math.round(elo)}`);
    this.send('isready');
    await this.#waitFor((l) => l === 'readyok');

    let info = { score: { type: 'cp', value: 0 }, pv: [], depth: 0 };
    this.send(`position fen ${fen}`);
    this.send(['go', depth ? `depth ${depth}` : '', movetime ? `movetime ${movetime}` : ''].join(' ').trim());
    const done = await this.#waitFor((l) => l.startsWith('bestmove'), (line) => {
      if (!line.startsWith('info') || !line.includes(' pv ')) return;
      const o = parseInfo(line);
      if (o.score && !o.bound && (o.multipv || 1) === 1) {
        info = o;
        onInfo?.(o);
      }
    });
    this.current = null;
    const best = done.split(' ')[1];
    return { bestmove: best && best !== '(none)' ? best : null, score: info.score, pv: info.pv, depth: info.depth };
  }

  // stop the running search early (it still resolves, with the best move so far).
  // with a tag, only stops if the running search has that tag.
  stop(tag) {
    if (this.current && (!tag || this.current.tag === tag)) this.send('stop');
  }
}

// ---------- score helpers ----------

// flip a side-to-move score to white's point of view
export function toWhite(score, turn) {
  return turn === 'w' ? score : { type: score.type, value: -score.value };
}

// white's winning chances, 0..100 (lichess's cp -> win% curve)
export function winPct(score) {
  if (score.type === 'mate') return score.value > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score.value)) - 1);
}

export function fmtScore(score) {
  if (score.type === 'mate') return (score.value > 0 ? '' : '-') + 'M' + Math.abs(score.value);
  const v = score.value / 100;
  if (Math.abs(v) < 0.05) return '0.0'; // no "-0.0"
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

export function uciToMove(uci) {
  if (!uci) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

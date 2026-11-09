// chess clock. time control strings look like "5+3" (minutes + increment seconds) or "none".

export const TIME_CONTROLS = ['none', '1+0', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '10+5', '15+10', '30+0'];

export function parseTC(s) {
  if (!s || s === 'none') return null;
  const [m, i] = s.split('+').map(Number);
  return { base: m * 60_000, inc: i * 1000, label: s };
}

function fmt(ms) {
  if (ms < 10_000) {
    const t = Math.floor(ms / 100) / 10; // tenths, rounded down so 0.0 means flagged
    return '0:0' + t.toFixed(1);
  }
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export class Clock {
  // els: { w: element, b: element } — each gets the formatted time + .active/.low classes
  constructor(els, onFlag) {
    this.els = els;
    this.onFlag = onFlag;
    this.tc = null;
    this.time = { w: 0, b: 0 };
    this.running = null; // color whose clock is ticking
    this.since = 0;
    this.timer = null;
  }

  get enabled() { return !!this.tc; }

  reset(tc) {
    this.stop();
    this.tc = tc;
    this.time = tc ? { w: tc.base, b: tc.base } : { w: 0, b: 0 };
    this.draw();
  }

  left(c) {
    let t = this.time[c];
    if (this.running === c) t -= performance.now() - this.since;
    return Math.max(0, t);
  }

  // `c` just finished a move: bank their time + increment, start the opponent.
  // the very first move of the game doesn't touch white's clock — it starts black's.
  moved(c) {
    if (!this.tc) return;
    if (this.running === c) this.time[c] = this.left(c) + this.tc.inc;
    this.#run(c === 'w' ? 'b' : 'w');
  }

  // set side to move without increments (undo, resync)
  resume(c) {
    if (!this.tc) return;
    if (this.running) this.time[this.running] = this.left(this.running);
    this.#run(c);
  }

  // authoritative times from the network, then run `c`
  sync(times, c) {
    if (!this.tc || !times) return;
    this.time = { w: times.w, b: times.b };
    this.running = null;
    this.#run(c);
  }

  stop() {
    if (this.running) this.time[this.running] = this.left(this.running);
    this.running = null;
    clearTimeout(this.timer);
    this.timer = null;
    this.draw();
  }

  #run(c) {
    this.running = c;
    this.since = performance.now();
    clearTimeout(this.timer);
    const tick = () => {
      this.draw();
      const c = this.running;
      if (!c) return;
      const ms = this.left(c);
      if (ms <= 0) {
        this.time[c] = 0;
        this.running = null;
        this.draw();
        this.onFlag?.(c);
        return;
      }
      this.timer = setTimeout(tick, ms < 10_000 ? 50 : 200);
    };
    tick();
  }

  draw() {
    for (const c of ['w', 'b']) {
      const el = this.els[c];
      if (!el) continue;
      el.hidden = !this.tc;
      if (!this.tc) continue;
      const ms = this.left(c);
      el.textContent = fmt(ms);
      el.classList.toggle('active', this.running === c);
      el.classList.toggle('low', ms < Math.min(20_000, this.tc.base * 0.15));
      el.classList.toggle('out', ms <= 0);
    }
  }
}

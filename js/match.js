// one game where you play one color and the other side's moves arrive on their own:
// a friend over webrtc (online mode) or the computer (bot mode). owns the game, clock,
// status line, result card and premove hand-off; the mode wires up the hooks.
// with me = null nobody is "you": both sides arrive through receive() (bot vs bot).
import { Chess } from 'chess.js';
import { animsFor, outcome } from './board.js';
import { Clock } from './clock.js';

const colorName = (c) => (c === 'w' ? 'white' : 'black');

export class Match {
  constructor({ board, col, clockEls, statusEl }) {
    this.board = board;
    this.col = col;
    this.statusEl = statusEl;
    this.clock = new Clock(clockEls, (c) => this.#flagged(c));
    this.game = null;
    this.me = 'w';         // 'w' | 'b', or null when watching
    this.names = null;     // { w, b } player names when watching
    this.over = false;
    this.result = null;
    this.themName = 'opponent';
    this.waitText = "opponent's move";

    this.onMyMove = null;  // (move) => void, after your move (or premove) is on the board
    this.onMyFlag = null;  // () => void, your clock ran out
    this.onOppFlag = null; // (color) => void, their clock ran out; default: they lose right away
    this.onEnd = null;     // (result) => void
    this.onChange = null;  // () => void, any position change

    board.movable = () => (this.game && !this.over ? this.me : null);
    board.onPremove = () => this.renderStatus();
    board.onMove = (mv) => {
      this.clock.moved(mv.color);
      const ended = this.#checkOutcome();
      this.onMyMove?.(mv);
      if (!ended) this.renderStatus();
      this.onChange?.();
    };
  }

  get them() { return this.me === 'w' ? 'b' : 'w'; }

  // me = null + names { w, b } to watch two others play
  start({ me, tc, themName, names, banner }) {
    this.game = new Chess();
    this.board.game = this.game;
    this.me = me;
    this.names = me ? null : names;
    this.over = false;
    this.result = null;
    if (themName) this.themName = themName;
    this.board.reset();
    this.board.orientation = me || 'w';
    this.col.dataset.orient = this.board.orientation;
    if (me) {
      this.col.querySelector(`.bar-${me} .name`).textContent = 'you';
      this.col.querySelector(`.bar-${this.them} .name`).textContent = this.themName;
    } else {
      this.col.querySelector('.bar-w .name').textContent = names.w;
      this.col.querySelector('.bar-b .name').textContent = names.b;
    }
    this.clock.reset(tc);
    this.board.render();
    this.renderStatus();
    if (banner) this.board.flash(banner);
    this.onChange?.();
  }

  // the other side moved. times = their authoritative clock readings (online), else counted locally
  // returns the move, or null if it wasn't legal here
  receive({ from, to, promotion }, times = null) {
    let mv;
    try {
      mv = this.game.move({ from, to, promotion: promotion || undefined });
    } catch {
      return null;
    }
    if (times) this.clock.sync(times, this.game.turn());
    else this.clock.moved(mv.color);
    if (this.#checkOutcome()) {
      this.board.render({ animate: animsFor(mv) });
    } else {
      this.board.playPremove(animsFor(mv)); // renders; plays your premove if it's still legal
      this.renderStatus();
    }
    this.onChange?.();
    return mv;
  }

  // undo `plies` half-moves (takebacks)
  takeback(plies) {
    const anims = [];
    let n = 0;
    while (n < plies) {
      const m = this.game.undo();
      if (!m) break;
      anims.push(...animsFor(m, true));
      n++;
    }
    if (!n) return 0;
    this.over = false;
    this.result = null;
    this.board.hideResult();
    this.board.premove = null;
    this.board.selected = null;
    this.board.render({ animate: anims });
    if (this.game.history().length === 0) this.clock.reset(this.clock.tc);
    else this.clock.resume(this.game.turn());
    this.renderStatus();
    this.onChange?.();
    return n;
  }

  finish(title, detail, cls = 'ok') {
    if (this.over) return;
    this.over = true;
    this.result = { title, detail, cls };
    this.clock.stop();
    this.board.premove = null;
    this.col.querySelectorAll('.bar').forEach((b) => b.classList.remove('turn'));
    this.board.showResult(title, detail);
    this.setStatus(`${title} · ${detail}`, cls);
    this.onEnd?.(this.result);
  }

  #checkOutcome() {
    const o = outcome(this.game);
    if (!o) return false;
    if (!o.winner) this.finish('draw', o.reason);
    else if (!this.me) this.finish(`${colorName(o.winner)} wins`, `${this.names[o.winner]} by ${o.reason}`);
    else if (o.winner === this.me) this.finish('you win', o.reason);
    else this.finish('you lose', o.reason, 'err');
    return true;
  }

  #flagged(c) {
    if (this.over) return;
    if (!this.me) {
      this.finish(`${colorName(c === 'w' ? 'b' : 'w')} wins`, `${this.names[c]} ran out of time`);
      this.board.render();
    } else if (c === this.me) {
      this.onMyFlag?.();
      this.finish('you lose', 'you ran out of time', 'err');
      this.board.render();
    } else if (this.onOppFlag) {
      this.onOppFlag(c);
    } else {
      this.finish('you win', `${this.themName} ran out of time`);
      this.board.render();
    }
  }

  setStatus(text, cls = '', turn = '') {
    const el = this.statusEl;
    el.textContent = text;
    el.className = 'status ' + cls;
    el.dataset.turn = turn;
  }

  renderStatus() {
    if (!this.game || this.over) return;
    const t = this.game.turn();
    this.col.querySelector('.bar-w').classList.toggle('turn', t === 'w');
    this.col.querySelector('.bar-b').classList.toggle('turn', t === 'b');
    let s = !this.me ? `${this.names[t]} (${colorName(t)}) is thinking…`
      : t === this.me ? 'your move' : this.board.premove ? 'premove set, right-click to cancel' : this.waitText;
    if (this.game.inCheck()) s += ' · check!';
    this.setStatus(s, '', t);
  }
}

// board view + interaction.
//  - click or drag to move (drag lifts the piece; click-moves slide)
//  - premoves: move your piece during the opponent's turn, it plays the instant they move
//  - right-click drag = arrow, right-click a square = circle, left-click clears them
//    (shift = red, alt = blue, ctrl = green). plain right-click also cancels a premove.
//  - promotion picker (unless auto-queen), "legacy" castling by dropping the king on its rook
//  - flash banner + result overlay
import { settings } from './settings.js';

const FILES = 'abcdefgh';
const NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const ARROW = { def: '#f2a33a', shift: '#e5484d', alt: '#3f8fe0', ctrl: '#3fae5a' };
const ANIM_MS = 180;
const SVGNS = 'http://www.w3.org/2000/svg';

const fileOf = (sq) => sq.charCodeAt(0) - 97;
const rankOf = (sq) => Number(sq[1]) - 1;
const sqName = (f, r) => FILES[f] + (r + 1);
const pieceClass = (p) => p.color + p.type.toUpperCase(); // e.g. "wK" -> background image in css

// slide animations for a move (castling also moves the rook). reverse = for undo / stepping back.
export function animsFor(mv, reverse = false) {
  if (!mv) return [];
  const r = mv.from[1];
  const list = [{ from: mv.from, to: mv.to }];
  if (mv.flags.includes('k')) list.push({ from: 'h' + r, to: 'f' + r });
  if (mv.flags.includes('q')) list.push({ from: 'a' + r, to: 'd' + r });
  return reverse ? list.map((a) => ({ from: a.to, to: a.from })) : list;
}

// where a piece could go next turn, ignoring the opponent (used for premoves).
// sliders stop at your own pieces but pass through enemy ones (they might move away).
function premoveDests(game, sq, castleOnRook) {
  const p = game.get(sq);
  if (!p) return [];
  const f = fileOf(sq), r = rankOf(sq), me = p.color;
  const out = new Map();
  const own = (ff, rr) => game.get(sqName(ff, rr))?.color === me;
  const add = (ff, rr) => {
    if (ff < 0 || ff > 7 || rr < 0 || rr > 7) return false;
    if (own(ff, rr)) return false;
    out.set(sqName(ff, rr), sqName(ff, rr));
    return true;
  };
  const slide = (dirs) => {
    for (const [df, dr] of dirs) {
      for (let i = 1; i < 8; i++) if (!add(f + df * i, r + dr * i)) break;
    }
  };
  const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const line = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  switch (p.type) {
    case 'p': {
      const dir = me === 'w' ? 1 : -1;
      const start = me === 'w' ? 1 : 6;
      if (add(f, r + dir) && r === start) add(f, r + 2 * dir);
      add(f - 1, r + dir);
      add(f + 1, r + dir);
      break;
    }
    case 'n':
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(f + df, r + dr);
      break;
    case 'b': slide(diag); break;
    case 'r': slide(line); break;
    case 'q': slide([...diag, ...line]); break;
    case 'k': {
      for (const [df, dr] of [...diag, ...line]) add(f + df, r + dr);
      const home = me === 'w' ? 0 : 7;
      if (f === 4 && r === home) {
        for (const [rookF, kingTo] of [[7, 6], [0, 2]]) {
          const rook = game.get(sqName(rookF, home));
          if (rook?.type !== 'r' || rook.color !== me) continue;
          out.set(sqName(kingTo, home), sqName(kingTo, home));
          if (castleOnRook) out.set(sqName(rookF, home), sqName(kingTo, home));
        }
      }
      break;
    }
  }
  return out; // dest square -> real king/piece destination
}

let boardCount = 0;

export class Board {
  constructor(el) {
    this.id = ++boardCount;
    this.el = el;
    el.classList.add('board');
    this.grid = document.createElement('div');
    this.grid.className = 'grid';
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'shapes');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.layer = document.createElement('div');
    this.layer.className = 'layer';
    el.replaceChildren(this.grid, this.svg, this.layer);

    this.game = null;
    this.orientation = 'w';
    this.movable = () => null; // color the user may move right now, or null
    this.onMove = null;        // (move) => void, after a user move (or premove) is applied
    this.onPremove = null;     // (premove | null) => void

    this.selected = null;
    this.targets = new Map();  // clicked/dropped square -> { from, to } (to = real destination)
    this.premove = null;       // { from, to, promotion }
    this.arrows = [];          // { from, to, color }
    this.marks = [];           // { sq, color }
    this.drag = null;
    this.rdrag = null;
    this.busy = false;         // promotion picker open
    this.sqEls = new Map();

    el.addEventListener('pointerdown', (e) => this.#down(e));
    el.addEventListener('pointermove', (e) => this.#move(e));
    el.addEventListener('pointerup', (e) => this.#up(e));
    el.addEventListener('pointercancel', () => this.#endDrag());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- public ----------

  reset() {
    this.#endDrag();
    this.selected = null;
    this.targets = new Map();
    this.premove = null;
    this.arrows = [];
    this.marks = [];
    this.hideResult();
    this.layer.querySelector('.promo')?.click(); // closes picker, resolves null
  }

  setOrientation(c, fade = false) {
    this.orientation = c;
    this.render();
    if (fade && settings.animate) {
      this.grid.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    }
  }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

  // apply the queued premove if it's legal now. extra = animations to run alongside (opponent's move)
  playPremove(extra = []) {
    const pm = this.premove;
    this.premove = null;
    let mv = null;
    if (pm && this.#mode() === 'move') {
      try { mv = this.game.move(pm); } catch { /* no longer legal, dropped */ }
    }
    if (pm) this.onPremove?.(null);
    const anims = mv ? [...extra.filter((a) => a.to !== mv.to), ...animsFor(mv)] : extra;
    this.render({ animate: anims });
    if (mv) this.onMove?.(mv);
    return mv;
  }

  cancelPremove() {
    if (!this.premove) return;
    this.premove = null;
    this.onPremove?.(null);
    this.render();
  }

  flash(text) {
    this.layer.querySelector('.flash')?.remove();
    const el = document.createElement('div');
    el.className = 'flash';
    el.textContent = text;
    el.addEventListener('animationend', () => el.remove());
    this.layer.appendChild(el);
  }

  showResult(title, detail) {
    this.hideResult();
    const wrap = document.createElement('div');
    wrap.className = 'result';
    const card = document.createElement('div');
    card.className = 'result-card';
    const t = document.createElement('div');
    t.className = 'result-title';
    t.textContent = title;
    const d = document.createElement('div');
    d.className = 'result-detail';
    d.textContent = detail || '';
    const hint = document.createElement('div');
    hint.className = 'result-hint';
    hint.textContent = 'click to view the board';
    card.append(t, d, hint);
    wrap.appendChild(card);
    wrap.addEventListener('click', () => this.hideResult());
    this.layer.appendChild(wrap);
  }

  hideResult() { this.layer.querySelector('.result')?.remove(); }

  // ---------- rendering ----------

  render({ animate = [] } = {}) {
    // anything that redraws the board (takeback, flip, timeout, opponent move) invalidates an open
    // promotion picker: close it, which cancels that move
    if (this.busy) this.layer.querySelector('.promo')?.click();
    const g = this.game;
    if (!g) return;
    const mode = this.#mode();
    const mover = this.movable();

    // keep selection valid across position changes (e.g. opponent moved while you had a piece picked)
    if (this.selected && (!mode || g.get(this.selected)?.color !== mover)) this.selected = null;
    this.targets = this.selected ? this.#targetsFor(this.selected, mode) : new Map();

    const hist = g.history({ verbose: true });
    const last = hist[hist.length - 1];
    const checkSq = g.inCheck() ? this.#kingSquare(g.turn()) : null;
    const pos = g.board();
    const frag = [];
    this.sqEls = new Map();

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const f = this.orientation === 'w' ? col : 7 - col;
        const r = this.orientation === 'w' ? 7 - row : row;
        const sq = sqName(f, r);
        const piece = pos[7 - r][f];
        const el = document.createElement('div');
        el.dataset.sq = sq;
        el.className = 'sq ' + ((f + r) % 2 ? 'light' : 'dark');
        if (last && (last.from === sq || last.to === sq)) el.classList.add('last');
        if (this.premove && (this.premove.from === sq || this.premove.to === sq)) el.classList.add('pre');
        if (sq === this.selected) el.classList.add('sel');
        if (sq === checkSq) el.classList.add('check');
        if (settings.showLegal && this.targets.has(sq) && sq !== this.selected) {
          el.classList.add(piece ? 'cap' : 'dot');
        }
        if (mode && piece && piece.color === mover) el.classList.add('own');

        if (settings.coords) {
          if (col === 0) el.appendChild(label('rank', r + 1));
          if (row === 7) el.appendChild(label('file', FILES[f]));
        }
        if (piece) {
          const p = document.createElement('span');
          p.className = 'pc ' + pieceClass(piece);
          p.setAttribute('role', 'img');
          p.setAttribute('aria-label', (piece.color === 'w' ? 'white ' : 'black ') + NAME[piece.type]);
          if (this.drag?.started && this.drag.from === sq) p.classList.add('ghost');
          el.appendChild(p);
        }
        this.sqEls.set(sq, el);
        frag.push(el);
      }
    }
    this.grid.replaceChildren(...frag);
    this.#drawShapes();
    if (settings.animate) this.#animate(animate);
  }

  #animate(list) {
    for (const { from, to } of list) {
      const pc = this.sqEls.get(to)?.querySelector('.pc');
      if (!pc) continue;
      const a = this.#cr(from), b = this.#cr(to);
      const dx = (a.col - b.col) * 100, dy = (a.row - b.row) * 100;
      pc.style.zIndex = 5;
      pc.animate(
        [{ transform: `translate(${dx}%, ${dy}%)` }, { transform: 'translate(0, 0)' }],
        { duration: ANIM_MS, easing: 'cubic-bezier(.2, .7, .3, 1)' },
      ).onfinish = () => { pc.style.zIndex = ''; };
    }
  }

  #drawShapes() {
    const parts = [];
    for (const m of this.marks) {
      const { x, y } = this.#center(m.sq);
      parts.push(`<circle cx="${x}" cy="${y}" r=".44" fill="none" stroke="${m.color}" stroke-width=".075" opacity=".85"/>`);
    }
    const arrows = [...this.arrows];
    const rd = this.rdrag;
    if (rd && rd.to !== rd.from) arrows.push(rd);
    for (const a of arrows) parts.push(this.#arrow(a));
    this.svg.innerHTML = parts.join('');
  }

  #arrow({ from, to, color }) {
    const s = this.#center(from), e = this.#center(to);
    const dxs = Math.abs(e.x - s.x), dys = Math.abs(e.y - s.y);
    // knight moves get an L-shaped arrow (long leg first)
    const knight = (dxs === 1 && dys === 2) || (dxs === 2 && dys === 1);
    const pts = [s];
    if (knight) pts.push(dxs > dys ? { x: e.x, y: s.y } : { x: s.x, y: e.y });
    const p = pts[pts.length - 1];
    const len = Math.hypot(e.x - p.x, e.y - p.y);
    const ux = (e.x - p.x) / len, uy = (e.y - p.y) / len;
    const head = 0.42, half = 0.27, tip = { x: e.x - ux * 0.08, y: e.y - uy * 0.08 };
    const base = { x: tip.x - ux * head, y: tip.y - uy * head };
    const d = 'M' + [...pts, base].map((q) => `${q.x} ${q.y}`).join(' L');
    const poly = [
      tip,
      { x: base.x - uy * half, y: base.y + ux * half },
      { x: base.x + uy * half, y: base.y - ux * half },
    ].map((q) => `${q.x},${q.y}`).join(' ');
    return `<g opacity=".8"><path d="${d}" fill="none" stroke="${color}" stroke-width=".17" stroke-linejoin="round"/>` +
      `<polygon points="${poly}" fill="${color}"/></g>`;
  }

  // ---------- geometry ----------

  #cr(sq) {
    const f = fileOf(sq), r = rankOf(sq);
    return this.orientation === 'w' ? { col: f, row: 7 - r } : { col: 7 - f, row: r };
  }
  #center(sq) { const { col, row } = this.#cr(sq); return { x: col + 0.5, y: row + 0.5 }; }

  #sqAt(x, y) {
    const rect = this.grid.getBoundingClientRect();
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return this.orientation === 'w' ? sqName(col, 7 - row) : sqName(7 - col, row);
  }

  #kingSquare(color) {
    const b = this.game.board();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const p = b[r][f];
      if (p && p.type === 'k' && p.color === color) return FILES[f] + (8 - r);
    }
    return null;
  }

  // ---------- move logic ----------

  // 'move' = your turn, 'premove' = opponent's turn with premoves on, null = can't touch
  #mode() {
    const c = this.movable?.();
    if (!c || !this.game || this.game.isGameOver()) return null;
    if (c === this.game.turn()) return 'move';
    return settings.premoves ? 'premove' : null;
  }

  #targetsFor(sq, mode) {
    const out = new Map();
    if (mode === 'premove') {
      for (const [dest, real] of premoveDests(this.game, sq, settings.castleOnRook)) out.set(dest, { from: sq, to: real });
      return out;
    }
    for (const m of this.game.moves({ square: sq, verbose: true })) {
      out.set(m.to, { from: m.from, to: m.to, promo: !!m.promotion });
      // legacy castling: king onto its own rook
      if (settings.castleOnRook && (m.flags.includes('k') || m.flags.includes('q'))) {
        out.set((m.flags.includes('k') ? 'h' : 'a') + m.from[1], { from: m.from, to: m.to });
      }
    }
    return out;
  }

  async #commit(from, dropSq, viaDrag) {
    const mode = this.#mode();
    const t = this.targets.get(dropSq);
    this.selected = null;
    if (!mode || !t) return this.render();
    const piece = this.game.get(from);
    const lastRank = t.to[1] === '8' || t.to[1] === '1';
    let promotion;
    if (piece.type === 'p' && lastRank) {
      promotion = settings.autoQueen ? 'q' : await this.#pickPromo(t.to, piece.color);
      if (!promotion || this.#mode() !== mode) return this.render();
    }

    if (mode === 'premove') {
      this.premove = { from, to: t.to, promotion };
      this.onPremove?.(this.premove);
      return this.render();
    }

    let mv = null;
    try { mv = this.game.move({ from, to: t.to, promotion }); } catch { /* shouldn't happen */ }
    if (!mv) return this.render();
    let anims = animsFor(mv);
    if (viaDrag) {
      // the dragged piece is already where you dropped it; only slide the rest
      anims = anims.slice(1);
      if (dropSq !== mv.to) anims.unshift({ from: dropSq, to: mv.to }); // king dropped on rook
    }
    this.render({ animate: anims });
    this.onMove?.(mv);
  }

  #pickPromo(sq, color) {
    return new Promise((resolve) => {
      this.busy = true;
      const { col, row } = this.#cr(sq);
      const down = row === 0;
      const wrap = document.createElement('div');
      wrap.className = 'promo';
      const done = (v) => { wrap.remove(); this.busy = false; resolve(v); };
      ['q', 'n', 'r', 'b'].forEach((t, i) => {
        const b = document.createElement('button');
        b.className = 'promo-pc ' + color + t.toUpperCase();
        b.style.left = col * 12.5 + '%';
        b.style.top = (down ? i : 7 - i) * 12.5 + '%';
        b.setAttribute('aria-label', 'promote to ' + NAME[t]);
        b.addEventListener('click', (e) => { e.stopPropagation(); done(t); });
        wrap.appendChild(b);
      });
      wrap.addEventListener('click', () => done(null));
      this.layer.appendChild(wrap);
    });
  }

  // ---------- pointer handling ----------

  #down(e) {
    if (this.busy || e.target.closest('.result')) return;
    const sq = this.#sqAt(e.clientX, e.clientY);

    if (e.button === 2) {
      if (!sq) return;
      const color = e.shiftKey ? ARROW.shift : e.altKey ? ARROW.alt : e.ctrlKey ? ARROW.ctrl : ARROW.def;
      this.rdrag = { from: sq, to: sq, color };
      this.#capture(e);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();

    if (this.arrows.length || this.marks.length) {
      this.arrows = [];
      this.marks = [];
      this.#drawShapes();
    }
    if (!sq) return;
    const mode = this.#mode();
    if (!mode) {
      if (this.selected) { this.selected = null; this.render(); }
      return;
    }

    if (this.selected && sq !== this.selected && this.targets.has(sq)) {
      this.#commit(this.selected, sq, false);
      return;
    }

    const piece = this.game.get(sq);
    if (piece && piece.color === this.movable()) {
      const wasSelected = this.selected === sq;
      this.selected = sq;
      this.drag = { from: sq, x: e.clientX, y: e.clientY, started: false, deselect: wasSelected };
      this.#capture(e);
      this.render();
      return;
    }

    // empty or enemy square: drop selection and any premove
    this.selected = null;
    if (this.premove) { this.premove = null; this.onPremove?.(null); }
    this.render();
  }

  #move(e) {
    const rd = this.rdrag;
    if (rd) {
      const sq = this.#sqAt(e.clientX, e.clientY);
      if (sq && sq !== rd.to) { rd.to = sq; this.#drawShapes(); }
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      const piece = this.game.get(d.from);
      if (!piece) { this.drag = null; return; }
      d.started = true;
      d.size = this.grid.getBoundingClientRect().width / 8;
      d.ghost = document.createElement('div');
      d.ghost.className = 'drag-ghost ' + pieceClass(piece);
      d.ghost.style.width = d.ghost.style.height = d.size + 'px';
      document.body.appendChild(d.ghost);
      this.sqEls.get(d.from)?.querySelector('.pc')?.classList.add('ghost');
      this.el.classList.add('dragging');
    }
    // position via `translate`, not `transform`: transform gets multiplied by the css lift `scale`,
    // which pushed the piece away from the cursor the further you were from the top-left
    d.ghost.style.translate = `${e.clientX - d.size / 2}px ${e.clientY - d.size / 2}px`;
    const sq = this.#sqAt(e.clientX, e.clientY);
    if (sq !== d.over) {
      this.sqEls.get(d.over)?.classList.remove('hover');
      d.over = sq;
      if (sq && this.targets.has(sq)) this.sqEls.get(sq)?.classList.add('hover');
    }
  }

  #up(e) {
    const rd = this.rdrag;
    if (rd) {
      this.rdrag = null;
      if (rd.from === rd.to) {
        if (this.premove) {
          this.cancelPremove(); // plain right-click cancels a premove
        } else {
          const i = this.marks.findIndex((m) => m.sq === rd.from);
          if (i >= 0 && this.marks[i].color === rd.color) this.marks.splice(i, 1);
          else if (i >= 0) this.marks[i].color = rd.color;
          else this.marks.push({ sq: rd.from, color: rd.color });
        }
      } else {
        const i = this.arrows.findIndex((a) => a.from === rd.from && a.to === rd.to);
        if (i >= 0 && this.arrows[i].color === rd.color) this.arrows.splice(i, 1);
        else if (i >= 0) this.arrows[i].color = rd.color;
        else this.arrows.push({ from: rd.from, to: rd.to, color: rd.color });
      }
      this.#drawShapes();
      return;
    }

    const d = this.drag;
    if (!d) return;
    const started = d.started;
    this.#endDrag();
    if (started) {
      const sq = this.#sqAt(e.clientX, e.clientY);
      if (sq && sq !== d.from && this.targets.has(sq)) return this.#commit(d.from, sq, true);
      if (sq !== d.from) this.selected = null; // dropped somewhere useless: snap back
      this.render();
    } else if (d.deselect) {
      this.selected = null; // clicked the already-selected piece
      this.render();
    }
  }

  #endDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.ghost?.remove();
    this.el.classList.remove('dragging');
    this.sqEls.get(d.over)?.classList.remove('hover');
    this.sqEls.get(d.from)?.querySelector('.pc')?.classList.remove('ghost');
  }

  #capture(e) {
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  }
}

function label(kind, text) {
  const s = document.createElement('span');
  s.className = 'lbl ' + kind;
  s.textContent = text;
  return s;
}

// game-over description from the board alone, or null if still going
export function outcome(game) {
  if (game.isCheckmate()) return { winner: game.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
  if (game.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (game.isThreefoldRepetition()) return { winner: null, reason: 'threefold repetition' };
  if (game.isInsufficientMaterial()) return { winner: null, reason: 'insufficient material' };
  if (game.isDraw()) return { winner: null, reason: '50-move rule' };
  return null;
}

export function resultText(game) {
  const o = outcome(game);
  if (!o) return null;
  return o.winner ? `${o.winner === 'w' ? 'white' : 'black'} wins by ${o.reason}` : `draw by ${o.reason}`;
}

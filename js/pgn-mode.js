// pgn mode: paste -> step through -> click a move to jump -> copy back out
import { Chess } from 'chess.js';
import { Board, animsFor, resultText } from './board.js';

export function initPGN(notify) {
  const $ = (s) => document.querySelector(s);
  const board = new Board($('#pgn-board')); // view only (movable stays null), arrows still work
  let master = null;   // chess instance the pgn was loaded into
  let history = [];    // verbose history of the loaded game
  let viewIndex = 0;   // how many half-moves are currently applied

  function replay() {
    const g = new Chess();
    for (let i = 0; i < viewIndex; i++) {
      const m = history[i];
      g.move({ from: m.from, to: m.to, promotion: m.promotion });
    }
    return g;
  }

  function render(animate = []) {
    const g = replay();
    const last = viewIndex > 0 ? history[viewIndex - 1] : null;
    board.game = g;
    board.render({ animate });

    // position label
    let label = viewIndex === 0 ? 'start position' : `${Math.floor(viewIndex / 2) + 1}${viewIndex % 2 ? '.' : '...'} ${last.san}`;
    const over = resultText(g);
    if (over) label += ' · ' + over;
    $('#pgn-pos').textContent = label;

    // move list highlight
    $('#pgn-list').querySelectorAll('.mv').forEach((el) => {
      el.classList.toggle('cur', Number(el.dataset.i) === viewIndex - 1);
    });
    $('#pgn-list').querySelector('.mv.cur')?.scrollIntoView({ block: 'nearest' });

    const enabled = history.length > 0;
    for (const id of ['pgn-first', 'pgn-prev', 'pgn-next', 'pgn-last', 'pgn-flip']) {
      $('#' + id).disabled = !enabled;
    }
  }

  function buildList() {
    const list = $('#pgn-list');
    const frag = [];
    let row = null;
    history.forEach((m, i) => {
      if (m.color === 'w' || !row) {
        row = document.createElement('div');
        row.className = 'row';
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = (Math.floor(i / 2) + 1) + (m.color === 'w' ? '.' : '…');
        row.appendChild(num);
        frag.push(row);
      }
      const mv = document.createElement('span');
      mv.className = 'mv';
      mv.dataset.i = i;
      mv.textContent = m.san;
      row.appendChild(mv);
    });
    list.replaceChildren(...frag);
  }

  function load() {
    const text = $('#pgn-input').value.trim();
    if (!text) return notify('paste a pgn first');
    const g = new Chess();
    try {
      g.loadPgn(text, { strict: false });
    } catch (e) {
      return notify("couldn't parse it: " + e.message);
    }
    history = g.history({ verbose: true });
    if (!history.length) return notify('no moves found in that pgn');
    master = g;
    viewIndex = 0;
    $('#pgn-copy').hidden = false;
    buildList();
    render();
    notify(`${history.length} half-moves loaded`);
  }

  function step(delta) {
    const prev = viewIndex;
    viewIndex = Math.max(0, Math.min(history.length, viewIndex + delta));
    // slide single steps; jumps just snap
    if (viewIndex === prev + 1) render(animsFor(history[prev]));
    else if (viewIndex === prev - 1) render(animsFor(history[viewIndex], true));
    else render();
  }

  $('#pgn-load').addEventListener('click', load);
  $('#pgn-first').addEventListener('click', () => step(-history.length));
  $('#pgn-prev').addEventListener('click', () => step(-1));
  $('#pgn-next').addEventListener('click', () => step(1));
  $('#pgn-last').addEventListener('click', () => step(history.length));
  $('#pgn-flip').addEventListener('click', () => board.flip());

  $('#pgn-list').addEventListener('click', (e) => {
    const mv = e.target.closest('.mv');
    if (!mv) return;
    viewIndex = Number(mv.dataset.i) + 1;
    render();
  });

  $('#pgn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(master.pgn());
      notify('pgn copied');
    } catch {
      notify('clipboard blocked, select the pgn box manually');
    }
  });

  // show the start position before anything is loaded
  board.game = new Chess();
  board.render();
  return board;
}

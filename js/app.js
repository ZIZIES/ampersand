import { Chess } from 'chess.js';
import { Board, animsFor, outcome } from './board.js';
import { initPGN } from './pgn-mode.js';
import { Conn } from './net.js';
import { Clock, TIME_CONTROLS, parseTC } from './clock.js';
import { Match } from './match.js';
import { MIN_RATING, MAX_RATING, botMove, stopBot, analyst, analyseGame, terminalScore, botName, describe } from './bot.js';
import { toWhite, winPct, fmtScore, uciToMove } from './engine.js';
import { settings, setSetting, onSetting, applyTheme, resetSettings, THEMES } from './settings.js';

const $ = (s) => document.querySelector(s);
const colorName = (c) => (c === 'w' ? 'white' : 'black');
const other = (c) => (c === 'w' ? 'b' : 'w');
const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

applyTheme();

// ---------- toast ----------
let toastTimer;
function toast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

async function copyText(ta, label) {
  const txt = ta.value.trim();
  if (!txt) return toast('nothing to copy yet');
  try {
    await navigator.clipboard.writeText(txt);
  } catch {
    ta.select();
    document.execCommand('copy');
  }
  toast(label || 'copied');
}

// click once to arm ("sure?"), again within 3s to confirm
function confirmButton(btn, fn) {
  const label = btn.querySelector('.t');
  const original = label.textContent;
  let timer;
  const disarm = () => { btn.classList.remove('armed'); label.textContent = original; };
  btn.addEventListener('click', () => {
    if (btn.classList.contains('armed')) {
      clearTimeout(timer);
      disarm();
      fn();
      return;
    }
    btn.classList.add('armed');
    label.textContent = 'sure?';
    timer = setTimeout(disarm, 3000);
  });
}

// time control chips bound to a settings key
function tcPicker(container, key, onChange) {
  const sync = () => container.querySelectorAll('.chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.tc === settings[key]));
  });
  container.replaceChildren(...TIME_CONTROLS.map((tc) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.tc = tc;
    b.textContent = tc === 'none' ? 'off' : tc;
    b.title = tc === 'none' ? 'no clock' : `${tc.split('+')[0]} min + ${tc.split('+')[1]} sec per move`;
    b.addEventListener('click', () => { setSetting(key, tc); sync(); onChange?.(tc); });
    return b;
  }));
  sync();
}

// ---------- tabs ----------
// a highlight ("pill") sits behind the active tab and slides to whichever you pick
const tabsNav = $('nav.tabs');
const pill = document.createElement('span');
pill.className = 'pill';
tabsNav.prepend(pill);
tabsNav.classList.add('has-pill');
function placePill() {
  const b = tabsNav.querySelector('button.active');
  pill.style.width = b.offsetWidth + 'px';
  pill.style.translate = `${b.offsetLeft}px 0`;
}
placePill();
pill.getBoundingClientRect(); // commit the first position before turning the slide on, so it doesn't slide in from 0
tabsNav.classList.add('pill-ready');
new ResizeObserver(placePill).observe(tabsNav); // window resizes, the web font loading in
document.querySelectorAll('nav [data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav [data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('main > section').forEach((sec) => {
      sec.hidden = sec.dataset.tab !== btn.dataset.tab;
    });
    placePill();
  });
});

// ---------- local mode ----------
const local = (() => {
  const board = new Board($('#local-board'));
  const col = $('#local-col');
  const clock = new Clock({ w: $('#local-clock-w'), b: $('#local-clock-b') }, (c) => {
    if (!over) { finish(other(c), `${colorName(c)} ran out of time`, 'time'); board.render(); }
  });
  let game = null;
  let over = null; // { text, kind }
  let flipTimer = null;

  board.movable = () => (over ? null : game.turn());

  function orient(c, fade = false) {
    board.setOrientation(c, fade);
    col.dataset.orient = c;
  }

  // auto-flip: after the move has slid into place, turn the board to the side to move
  function faceSideToMove(delay) {
    clearTimeout(flipTimer);
    if (!settings.autoFlip || over || board.orientation === game.turn()) return;
    flipTimer = setTimeout(() => {
      if (settings.autoFlip && !over && board.orientation !== game.turn()) orient(game.turn(), true);
    }, delay);
  }

  function status() {
    const el = $('#local-status');
    col.querySelector('.bar-w').classList.toggle('turn', !over && game.turn() === 'w');
    col.querySelector('.bar-b').classList.toggle('turn', !over && game.turn() === 'b');
    if (over) {
      el.textContent = over.text;
      el.className = 'status ok';
      el.dataset.turn = '';
      return;
    }
    el.textContent = `${colorName(game.turn())} to move${game.inCheck() ? ' · check!' : ''}`;
    el.className = 'status';
    el.dataset.turn = game.turn();
  }

  function finish(winner, reason, kind = 'board') {
    const title = winner ? `${colorName(winner)} wins` : 'draw';
    over = { text: `${title} · ${reason}`, kind };
    clock.stop();
    board.showResult(title, reason);
    status();
  }

  function newGame() {
    game = new Chess();
    board.game = game;
    over = null;
    board.reset();
    clearTimeout(flipTimer);
    if (settings.autoFlip) { board.orientation = 'w'; col.dataset.orient = 'w'; }
    const tc = parseTC(settings.localTc);
    clock.reset(tc);
    board.render();
    status();
    board.flash(tc ? `game on · ${tc.label}` : 'game on');
  }

  board.onMove = (mv) => {
    clock.moved(mv.color);
    const o = outcome(game);
    if (o) finish(o.winner, o.reason);
    status();
    faceSideToMove(settings.animate ? 450 : 250);
  };

  $('#local-new').addEventListener('click', newGame);
  $('#local-undo').addEventListener('click', () => {
    if (over?.kind === 'time') return toast("time's up, start a new game");
    const m = game.undo();
    if (!m) return;
    over = null;
    board.hideResult();
    board.selected = null;
    board.render({ animate: animsFor(m, true) });
    if (game.history().length === 0) clock.reset(parseTC(settings.localTc));
    else clock.resume(game.turn());
    status();
    faceSideToMove(settings.animate ? 450 : 250);
  });
  $('#local-flip').addEventListener('click', () => {
    clearTimeout(flipTimer);
    orient(board.orientation === 'w' ? 'b' : 'w');
  });
  confirmButton($('#local-resign'), () => {
    if (over) return toast('game is already over');
    finish(other(game.turn()), `${colorName(game.turn())} resigned`, 'resign');
    board.render();
  });
  tcPicker($('#local-tc'), 'localTc', () => {
    if (!over && game.history().length === 0) clock.reset(parseTC(settings.localTc));
    else toast('time control kicks in next game');
  });

  newGame();
  return { board, faceSideToMove };
})();

// ---------- pgn mode ----------
const pgnBoard = initPGN(toast);

// ---------- online mode ----------
const net = (() => {
  const board = new Board($('#net-board'));
  const match = new Match({
    board,
    col: $('#net-col'),
    clockEls: { w: $('#net-clock-w'), b: $('#net-clock-b') },
    statusEl: $('#net-status'),
  });
  let conn = null;
  let iAmHost = false;
  let rematchLock = false;
  let tcStr = 'none';   // agreed time control (host decides, sent in 'hello')
  let graceTimer = null;

  // the status line lives in the game panel, which is hidden during setup, so toast it there too
  function setNetStatus(text, cls) {
    match.setStatus(text, cls);
    if ($('#net-game').hidden) toast(text);
  }

  const tcBanner = () => (tcStr !== 'none' ? ` · ${tcStr}` : '');

  function newGame(me, banner) {
    clearTimeout(graceTimer);
    $('#net-draw-ask').hidden = true;
    match.start({ me, tc: parseTC(tcStr), themName: 'opponent', banner });
  }

  match.onMyMove = (mv) => conn?.send({
    t: 'move', from: mv.from, to: mv.to, promo: mv.promotion || null,
    clock: match.clock.enabled ? { w: match.clock.left('w'), b: match.clock.left('b') } : null,
  });
  match.onMyFlag = () => conn?.send({ t: 'flag' });
  match.onOppFlag = () => {
    // their clock hit zero on our screen; give their last move a moment to arrive
    graceTimer = setTimeout(() => {
      if (!match.over) { match.finish('you win', 'opponent ran out of time'); board.render(); }
    }, 2500);
  };
  match.onEnd = () => {
    clearTimeout(graceTimer);
    $('#net-draw-ask').hidden = true;
  };

  function rematch(iInitiated) {
    const me = other(match.me);
    newGame(me, `rematch · you're ${colorName(me)}${tcBanner()}`);
    if (iInitiated) conn?.send({ t: 'rematch' });
  }

  const handlers = {
    onOpen() {
      if (iAmHost) {
        tcStr = settings.hostTc;
        conn.send({ t: 'hello', tc: tcStr });
      }
      $('#net-setup').hidden = true;
      $('#net-game').hidden = false;
      const me = iAmHost ? 'w' : 'b';
      newGame(me, `game on · you're ${colorName(me)}${tcBanner()}`);
    },
    onMessage(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'hello':
          if (!iAmHost && TIME_CONTROLS.includes(m.tc)) {
            tcStr = m.tc;
            match.clock.reset(parseTC(tcStr));
            if (tcStr !== 'none') board.flash(`game on · you're ${colorName(match.me)}${tcBanner()}`);
          }
          break;
        case 'move':
          if (!match.game || match.over) return;
          clearTimeout(graceTimer);
          if (!match.receive({ from: m.from, to: m.to, promotion: m.promo }, m.clock)) {
            toast('illegal move received. you two are out of sync, rematch or rehost');
          }
          break;
        case 'flag':
          if (!match.over) { match.finish('you win', 'opponent ran out of time'); board.render(); }
          break;
        case 'resign':
          if (!match.over) { match.finish('you win', 'opponent resigned'); board.render(); }
          break;
        case 'draw-offer':
          if (!match.over) {
            $('#net-draw-ask').hidden = false;
            match.setStatus('opponent offers a draw');
          }
          break;
        case 'draw-accept':
          if (!match.over) { match.finish('draw', 'by agreement'); board.render(); }
          break;
        case 'draw-decline':
          toast('draw declined');
          break;
        case 'rematch':
          if (!rematchLock) {
            rematchLock = true;
            setTimeout(() => (rematchLock = false), 2000);
            rematch(false);
          }
          break;
      }
    },
    onClose() {
      match.clock.stop();
      setNetStatus('connection lost. make fresh codes to play again', 'err');
    },
    onState(st) {
      if (st === 'failed') setNetStatus('connection failed. your network might be blocking webrtc', 'err');
    },
  };

  // host flow
  tcPicker($('#host-tc'), 'hostTc');
  $('#host-create').addEventListener('click', async () => {
    try {
      conn?.close();
      iAmHost = true;
      conn = new Conn(handlers);
      $('#host-code').value = 'generating…';
      $('#host-code').value = await conn.host();
      $('#host-copy').hidden = false;
      $('#host-step2').hidden = false;
      setNetStatus('send the code to your friend');
    } catch (e) {
      $('#host-code').value = '';
      setNetStatus('failed: ' + e.message, 'err');
    }
  });
  $('#host-copy').addEventListener('click', () => copyText($('#host-code'), 'code copied'));
  $('#host-connect').addEventListener('click', async () => {
    try {
      await conn.acceptReply($('#host-reply').value);
      setNetStatus('connecting…');
    } catch (e) {
      toast(e.message);
    }
  });

  // join flow
  $('#join-make').addEventListener('click', async () => {
    try {
      conn?.close();
      iAmHost = false;
      conn = new Conn(handlers);
      $('#join-reply').value = await conn.join($('#join-offer').value);
      $('#join-step2').hidden = false;
      setNetStatus('send the reply code back to the host');
    } catch (e) {
      setNetStatus(e.message, 'err');
    }
  });
  $('#join-copy').addEventListener('click', () => copyText($('#join-reply'), 'reply copied'));

  // in-game buttons
  confirmButton($('#net-resign'), () => {
    if (match.over || !conn) return;
    conn.send({ t: 'resign' });
    match.finish('you lose', 'you resigned', 'err');
    board.render();
  });
  $('#net-draw').addEventListener('click', () => {
    if (match.over || !conn) return;
    conn.send({ t: 'draw-offer' });
    toast('draw offered');
  });
  $('#net-draw-yes').addEventListener('click', () => {
    if (match.over) return;
    conn?.send({ t: 'draw-accept' });
    match.finish('draw', 'by agreement');
    board.render();
  });
  $('#net-draw-no').addEventListener('click', () => {
    $('#net-draw-ask').hidden = true;
    conn?.send({ t: 'draw-decline' });
    match.renderStatus();
  });
  $('#net-rematch').addEventListener('click', () => {
    if (!conn || rematchLock) return;
    rematchLock = true;
    setTimeout(() => (rematchLock = false), 2000);
    rematch(true);
  });

  return { board };
})();

// ---------- bot mode ----------
const bot = (() => {
  const board = new Board($('#bot-board'));
  const col = $('#bot-col');
  const match = new Match({
    board,
    col,
    clockEls: { w: $('#bot-clock-w'), b: $('#bot-clock-b') },
    statusEl: $('#bot-status'),
  });
  match.waitText = 'bot is thinking…';
  const HINT_COLOR = '#3fae5a';
  let ratings = {};       // this game's bot rating per color: { b: 1200 } vs you, { w, b } bot vs bot
  let paused = false;     // bot vs bot only
  let thinkToken = 0;
  let evalToken = 0;
  let review = null;      // { hist, data, index } while the review panel is open
  let reviewCache = null; // { pgn, data }; reopening review of the same game is instant

  const panels = { setup: $('#bot-setup'), play: $('#bot-play'), review: $('#bot-review') };
  function show(name) {
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== name;
    $('#bot-stepper').hidden = name !== 'review';
  }

  // ----- setup -----
  const watching = () => settings.botMode === 'watch';

  // a 400..max strength slider bound to a settings key; returns a reader for its value
  function ratingSlider(id, key) {
    const input = $('#' + id);
    const num = $(`#${id}-num`), desc = $(`#${id}-desc`);
    input.min = MIN_RATING;
    input.max = MAX_RATING;
    input.step = 50;
    input.value = settings[key];
    const sync = () => {
      const r = Number(input.value);
      num.textContent = r >= MAX_RATING ? 'max' : r;
      desc.textContent = describe(r);
      input.style.setProperty('--pct', ((r - MIN_RATING) / (MAX_RATING - MIN_RATING)) * 100 + '%');
      syncNames();
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', () => setSetting(key, Number(input.value)));
    queueMicrotask(sync); // after the other sliders exist
    return () => Number(input.value);
  }
  const playRating = ratingSlider('bot-rating', 'botRating');
  const watchRating = { w: ratingSlider('watch-w', 'watchW'), b: ratingSlider('watch-b', 'watchB') };

  function previewColor() {
    return !watching() && settings.botColor === 'b' ? 'b' : 'w';
  }
  // names on the bars while the setup panel is up
  function syncNames() {
    if (panels.setup.hidden) return;
    if (watching()) {
      col.querySelector('.bar-w .name').textContent = botName(watchRating.w());
      col.querySelector('.bar-b .name').textContent = botName(watchRating.b());
    } else {
      const me = previewColor();
      col.querySelector(`.bar-${me} .name`).textContent = 'you';
      col.querySelector(`.bar-${other(me)} .name`).textContent = botName(playRating());
    }
  }

  // you vs bot / bot vs bot
  const modeBtns = [...document.querySelectorAll('#bot-mode [data-mode]')];
  function syncMode() {
    const w = watching();
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === settings.botMode)));
    $('#bot-play-opts').hidden = w;
    $('#bot-watch-opts').hidden = !w;
    $('#bot-setup-title').textContent = w ? 'bot vs bot' : 'play the bot';
    $('#bot-start .t').textContent = w ? 'watch' : 'play';
    $('#bot-start use').setAttribute('href', w ? '#i-play' : '#i-bot');
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => {
    setSetting('botMode', b.dataset.mode);
    syncMode();
    if (!panels.setup.hidden) showSetup();
  }));

  const speedBtns = [...document.querySelectorAll('#watch-speed [data-speed]')];
  const syncSpeed = () => speedBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.speed === settings.watchSpeed)));
  speedBtns.forEach((b) => b.addEventListener('click', () => { setSetting('watchSpeed', b.dataset.speed); syncSpeed(); }));

  const colorBtns = [...document.querySelectorAll('#bot-color [data-color]')];
  function syncColor() {
    colorBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === settings.botColor)));
  }
  colorBtns.forEach((b) => b.addEventListener('click', () => {
    setSetting('botColor', b.dataset.color);
    syncColor();
    if (!panels.setup.hidden) showSetup();
  }));
  tcPicker($('#bot-tc'), 'botTc', () => { if (!panels.setup.hidden) match.clock.reset(parseTC(settings.botTc)); });

  function showSetup() {
    cancelThink();
    clearPause();
    leaveReview();
    match.game = null; // board stays inert until you press play
    match.over = false;
    board.reset();
    board.game = new Chess();
    board.orientation = previewColor();
    col.dataset.orient = board.orientation;
    col.querySelectorAll('.bar').forEach((b) => b.classList.remove('turn'));
    match.clock.reset(parseTC(settings.botTc));
    board.render();
    show('setup');
    syncMode();
    syncNames();
    drawEval({ type: 'cp', value: 0 });
  }

  $('#bot-start').addEventListener('click', () => {
    reviewCache = null;
    clearPause();
    show('play');
    const tc = parseTC(settings.botTc);
    const w = watching();
    $('#bot-play-btns').hidden = w;
    $('#bot-play-hint').hidden = w;
    $('#bot-watch-btns').hidden = !w;
    if (w) {
      ratings = { w: watchRating.w(), b: watchRating.b() };
      const names = { w: botName(ratings.w), b: botName(ratings.b) };
      $('#bot-title').textContent = `${names.w} vs ${names.b}`;
      match.start({ me: null, names, tc, banner: 'bot vs bot' });
      think();
    } else {
      const me = settings.botColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.botColor;
      ratings = { [other(me)]: playRating() };
      const name = botName(ratings[other(me)]);
      $('#bot-title').textContent = `vs ${name}`;
      match.start({ me, tc, themName: name, banner: `game on · you're ${colorName(me)}` });
      if (me === 'b') think();
    }
  });

  // ----- the bot's turn (when watching, whichever side is to move) -----
  // bot vs bot speed: least time per move in ms, and whether bots add their "human" pause
  const SPEED = { slow: { min: 1800, human: true }, normal: { min: 0, human: true }, fast: { min: 300, human: false } };
  async function think() {
    const g = match.game;
    if (!g || match.over || paused || g.turn() === match.me) return;
    const token = ++thinkToken;
    const fen = g.fen(), turn = g.turn();
    const speed = match.me ? SPEED.normal : SPEED[settings.watchSpeed] || SPEED.normal;
    const started = performance.now();
    syncButtons();
    let mv;
    try {
      const clock = match.clock;
      const msLeft = clock.enabled ? clock.left(turn) : null;
      mv = await botMove(fen, ratings[turn], { msLeft, inc: clock.tc?.inc || 0, humanDelay: speed.human });
      let wait = speed.min - (performance.now() - started);
      if (msLeft != null) wait = Math.min(wait, msLeft / 40); // don't let "slow" lose on time
      if (wait > 0) await sleep(wait);
    } catch (e) {
      toast('engine error: ' + e.message);
      return;
    }
    if (token !== thinkToken || match.over || paused || match.game !== g || g.fen() !== fen) return;
    if (!mv || !match.receive(mv)) return toast('the bot got confused, try a new game');
    syncButtons();
    if (!match.me) think(); // the other bot's turn
  }
  function cancelThink() {
    thinkToken++;
    stopBot();
  }
  match.onMyMove = () => { if (!match.over) think(); };
  match.onEnd = () => { cancelThink(); syncButtons(); };
  match.onChange = () => { refreshEval(); syncButtons(); };

  function syncButtons() {
    const g = match.game;
    const live = g && !match.over;
    $('#watch-pause').disabled = !live;
    $('#bot-hint').disabled = !(live && g.turn() === match.me);
    $('#bot-takeback').disabled = !g || !g.history({ verbose: true }).some((m) => m.color === match.me);
    $('#bot-resign').disabled = !live;
    $('#bot-review-btn').hidden = !(g && match.over);
  }

  // ----- buttons -----
  $('#bot-hint').addEventListener('click', async () => {
    const g = match.game;
    if (!g || match.over || g.turn() !== match.me) return;
    const fen = g.fen();
    $('#bot-hint').disabled = true;
    try {
      const r = await analyst().search(fen, { movetime: 900, tag: 'hint' });
      if (match.game !== g || g.fen() !== fen || !r?.bestmove) return;
      const m = uciToMove(r.bestmove);
      board.arrows = [{ from: m.from, to: m.to, color: HINT_COLOR }];
      board.render();
      toast('hint: ' + new Chess(fen).move(m).san);
    } catch (e) {
      toast(e.message);
    } finally {
      syncButtons();
    }
  });

  $('#bot-takeback').addEventListener('click', () => {
    const g = match.game;
    if (!g) return;
    if (match.over && /time/.test(match.result?.detail)) return toast("time's up, start a new game");
    if (!g.history({ verbose: true }).some((m) => m.color === match.me)) return toast('nothing to take back');
    cancelThink();
    // back to your last move: 1 half-move if the bot hasn't answered yet, 2 if it has
    match.takeback(g.turn() === match.me ? 2 : 1);
  });

  confirmButton($('#bot-resign'), () => {
    if (!match.game || match.over) return;
    cancelThink();
    match.finish('you lose', 'you resigned', 'err');
    board.render();
  });

  $('#bot-new').addEventListener('click', showSetup);

  // ----- bot vs bot controls -----
  function pauseButton() {
    const btn = $('#watch-pause');
    btn.querySelector('.t').textContent = paused ? 'resume' : 'pause';
    btn.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  }
  // forget the pause without touching the game (leaving it, or starting a new one)
  function clearPause() {
    paused = false;
    pauseButton();
  }
  function setPaused(p) {
    paused = p;
    pauseButton();
    const g = match.game;
    if (!g || match.over || match.me) return;
    if (p) {
      cancelThink();
      match.clock.stop();
      match.setStatus('paused', '', g.turn());
    } else {
      if (g.history().length) match.clock.resume(g.turn()); // clocks start after white's first move
      match.renderStatus();
      think();
    }
  }
  $('#watch-pause').addEventListener('click', () => setPaused(!paused));
  $('#watch-flip').addEventListener('click', () => {
    board.flip();
    col.dataset.orient = board.orientation;
    drawEval(lastScore);
  });
  $('#watch-new').addEventListener('click', showSetup);

  // ----- eval bar -----
  let lastScore = { type: 'cp', value: 0 };
  function drawEval(score) {
    lastScore = score;
    const bar = $('#bot-eval');
    bar.hidden = !settings.evalBar;
    const pct = winPct(score); // white's share
    const whiteBottom = board.orientation === 'w';
    bar.classList.toggle('flipped', !whiteBottom);
    bar.querySelector('.fill').style.height = pct + '%';
    const label = bar.querySelector('.label');
    label.textContent = score.type === 'mate' && Math.abs(score.value) < 1 ? '#' : fmtScore(score).replace('+', '');
    const whiteAhead = pct >= 50;
    label.classList.toggle('on-white', whiteAhead);
    label.classList.toggle('at-bottom', whiteAhead === whiteBottom);
  }

  async function refreshEval() {
    $('#bot-eval').hidden = !settings.evalBar;
    if (!settings.evalBar || review) return;
    const g = match.game;
    if (!g) return drawEval({ type: 'cp', value: 0 });
    const id = ++evalToken;
    const term = terminalScore(g);
    if (term) return drawEval(term);
    const fen = g.fen(), turn = g.turn();
    analyst().stop('eval'); // newest position wins
    try {
      const r = await analyst().search(fen, { depth: 16, movetime: 700, tag: 'eval', skipIf: () => id !== evalToken });
      if (r && id === evalToken) drawEval(toWhite(r.score, turn));
    } catch { /* engine unavailable, leave the bar */ }
  }

  // ----- game review -----
  $('#bot-review-btn').addEventListener('click', async () => {
    const hist = match.game?.history({ verbose: true }) || [];
    if (!hist.length) return toast('no moves to review');
    board.hideResult();
    const me = { hist, data: null, index: hist.length };
    review = me;
    show('review');
    $('#review-progress').hidden = false;
    $('#review-body').hidden = true;
    const pgn = match.game.pgn();
    let data = reviewCache?.pgn === pgn ? reviewCache.data : null;
    if (!data) {
      try {
        data = await analyseGame(hist, {
          shouldStop: () => review !== me,
          onProgress: (i, n) => {
            if (review !== me) return;
            $('#review-progress .progress-fill').style.width = (i / n) * 100 + '%';
            $('#review-progress .progress-text').textContent = `analysing ${i} / ${n} positions…`;
          },
        });
      } catch (e) {
        toast(e.message);
        return;
      }
      if (!data || review !== me) return;
      reviewCache = { pgn, data };
    }
    me.data = data;
    $('#review-progress').hidden = true;
    $('#review-body').hidden = false;
    buildReview();
    showIndex(hist.length);
  });

  function leaveReview() {
    if (!review) return;
    review = null;
    analyst().stop('review');
    board.arrows = [];
    if (match.game) board.game = match.game;
  }

  $('#review-back').addEventListener('click', () => {
    leaveReview();
    board.render();
    show('play');
    refreshEval();
    syncButtons();
  });

  const GLYPH = { blunder: '??', mistake: '?', inaccuracy: '?!' };
  const LABEL = { best: 'best move', good: 'good', inaccuracy: 'inaccuracy', mistake: 'mistake', blunder: 'blunder' };

  function buildReview() {
    const { data, hist } = review;
    // columns: you + the bot, or white + black when you watched
    const [a, b] = match.me ? [match.me, other(match.me)] : ['w', 'b'];
    const head = (c) => (c === match.me ? 'you' : botName(ratings[c]));
    const s = data.summary;
    const row = (label, key, fmt = (v) => v) =>
      `<tr><td>${label}</td><td>${fmt(s[a][key])}</td><td>${fmt(s[b][key])}</td></tr>`;
    $('#review-summary').innerHTML =
      `<thead><tr><th></th><th>${head(a)}</th><th>${head(b)}</th></tr></thead><tbody>` +
      row('accuracy', 'accuracy', (v) => (v == null ? '–' : v + '%')) +
      row('<i class="tag inaccuracy">?!</i> inaccuracies', 'inaccuracy') +
      row('<i class="tag mistake">?</i> mistakes', 'mistake') +
      row('<i class="tag blunder">??</i> blunders', 'blunder') +
      '</tbody>';

    const list = $('#review-list');
    const rows = [];
    let r = null;
    hist.forEach((m, i) => {
      if (m.color === 'w' || !r) {
        r = document.createElement('div');
        r.className = 'row';
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = Math.floor(i / 2) + 1 + (m.color === 'w' ? '.' : '…');
        r.appendChild(num);
        rows.push(r);
      }
      const cls = data.moves[i].cls;
      const mv = document.createElement('span');
      mv.className = 'mv ' + cls;
      mv.dataset.i = i + 1;
      mv.textContent = m.san;
      if (GLYPH[cls]) {
        const t = document.createElement('i');
        t.className = 'tag ' + cls;
        t.textContent = GLYPH[cls];
        mv.appendChild(t);
      }
      r.appendChild(mv);
    });
    list.replaceChildren(...rows);
  }

  function drawGraph() {
    const { data, index } = review;
    const W = 300, H = 72, n = Math.max(1, data.evals.length - 1);
    const x = (i) => ((i / n) * W).toFixed(1);
    const y = (s) => (H - (winPct(s) / 100) * H).toFixed(1);
    const area = `M0 ${H} ` + data.evals.map((s, i) => `L${x(i)} ${y(s)}`).join(' ') + ` L${W} ${H} Z`;
    const marks = data.moves.map((m, i) => (m.cls === 'blunder' || m.cls === 'mistake'
      ? `<line class="mark ${m.cls}" x1="${x(i + 1)}" x2="${x(i + 1)}" y1="0" y2="${H}"/>` : '')).join('');
    $('#review-graph').innerHTML =
      `<path class="area" d="${area}"/><line class="mid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>` +
      marks + `<line class="cur" x1="${x(index)}" x2="${x(index)}" y1="0" y2="${H}"/>`;
  }

  function showIndex(i, animate = []) {
    if (!review?.data) return;
    const { hist, data } = review;
    i = Math.max(0, Math.min(hist.length, i));
    review.index = i;
    const g = new Chess();
    for (let k = 0; k < i; k++) g.move(hist[k]);
    board.game = g;
    board.arrows = [];
    let text = 'start position';
    if (i > 0) {
      const m = data.moves[i - 1];
      const moveNo = `${Math.floor((i - 1) / 2) + 1}${m.color === 'w' ? '.' : '…'} ${m.san}`;
      text = `${moveNo} · ${LABEL[m.cls]}`;
      if (GLYPH[m.cls] && m.best) {
        const before = new Chess();
        for (let k = 0; k < i - 1; k++) before.move(hist[k]);
        const bm = uciToMove(m.best);
        board.arrows = [{ from: bm.from, to: bm.to, color: HINT_COLOR }];
        text += ` · best was ${before.move(bm).san}`;
      }
      $('#review-pos').className = 'status pos ' + m.cls;
    } else {
      $('#review-pos').className = 'status pos';
    }
    $('#review-pos').textContent = text;
    board.render({ animate });
    drawEval(data.evals[i]);
    drawGraph();
    $('#review-list').querySelectorAll('.mv').forEach((el) => el.classList.toggle('cur', Number(el.dataset.i) === i));
    $('#review-list .mv.cur')?.scrollIntoView({ block: 'nearest' });
  }

  function step(delta) {
    if (!review?.data) return;
    const prev = review.index;
    const next = Math.max(0, Math.min(review.hist.length, prev + delta));
    if (next === prev + 1) showIndex(next, animsFor(review.hist[prev]));
    else if (next === prev - 1) showIndex(next, animsFor(review.hist[next], true));
    else showIndex(next);
  }

  $('#rv-first').addEventListener('click', () => step(-Infinity));
  $('#rv-prev').addEventListener('click', () => step(-1));
  $('#rv-next').addEventListener('click', () => step(1));
  $('#rv-last').addEventListener('click', () => step(Infinity));
  $('#review-list').addEventListener('click', (e) => {
    const mv = e.target.closest('.mv');
    if (mv) showIndex(Number(mv.dataset.i));
  });
  $('#review-graph').addEventListener('click', (e) => {
    if (!review?.data) return;
    const r = e.currentTarget.getBoundingClientRect();
    showIndex(Math.round(((e.clientX - r.left) / r.width) * review.hist.length));
  });
  document.addEventListener('keydown', (e) => {
    if (!review?.data || panels.review.hidden || $('section[data-tab=bot]').hidden) return;
    if (e.target instanceof Element && e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });

  syncColor();
  syncSpeed();
  showSetup();
  return { board, refreshEval };
})();

// ---------- settings drawer ----------
{
  const drawer = $('#settings');
  const scrim = $('#scrim');
  const boards = [local.board, pgnBoard, net.board, bot.board];

  function open(yes) {
    drawer.classList.toggle('open', yes);
    scrim.classList.toggle('open', yes);
    drawer.inert = !yes;
    $('#settings-open').setAttribute('aria-expanded', String(yes));
    if (yes) $('#settings-close').focus();
  }
  $('#settings-open').addEventListener('click', () => open(true));
  $('#settings-close').addEventListener('click', () => open(false));
  scrim.addEventListener('click', () => open(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) open(false);
  });

  // the setup dialog shows some of the same toggles: copy them from the drawer so the wording lives in one place
  $('#setup').querySelectorAll('[data-toggles]').forEach((box) => {
    box.replaceChildren(...box.dataset.toggles.split(' ').map((key) =>
      drawer.querySelector(`input[data-setting="${key}"]`).closest('label').cloneNode(true)));
  });

  // every toggle for a key (drawer + setup) stays in sync
  const syncToggles = (key) => document.querySelectorAll(`input[data-setting="${key}"]`).forEach((input) => {
    input.checked = !!settings[key];
  });
  document.querySelectorAll('input[data-setting]').forEach((input) => {
    input.checked = !!settings[input.dataset.setting];
    input.addEventListener('change', () => setSetting(input.dataset.setting, input.checked));
  });

  for (const box of [$('#themes'), $('#setup-themes')]) {
    box.replaceChildren(...THEMES.map((name) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.theme = name;
      b.title = name;
      b.setAttribute('aria-label', name + ' board');
      b.addEventListener('click', () => setSetting('theme', name));
      return b;
    }));
  }
  const syncThemes = () => document.querySelectorAll('.swatch').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.theme === settings.theme));
  });
  syncThemes();

  onSetting((key) => {
    syncToggles(key);
    if (key === 'theme') syncThemes();
    if (key === 'autoFlip' && settings.autoFlip) local.faceSideToMove(0);
    if (key === 'evalBar') bot.refreshEval();
    if (['showLegal', 'coords', 'castleOnRook', 'premoves'].includes(key)) boards.forEach((b) => b.render());
  });
}

// ---------- first-visit setup ----------
// a few steps over the main settings, shown once. skip (or escape) keeps the defaults.
{
  const dlg = $('#setup');
  const card = dlg.querySelector('.setup-card');
  const steps = [...dlg.querySelectorAll('.step')];
  const dots = dlg.querySelector('.steps');
  dots.replaceChildren(...steps.map(() => document.createElement('i')));
  let at = 0;

  // a free-play board to try the colors and moving on; both sides are yours
  const preview = new Board($('#setup-board'));
  preview.movable = () => (preview.game.isGameOver() ? null : preview.game.turn());
  onSetting(() => { if (dlg.open) preview.render(); });

  function show(n) {
    const dir = Math.sign(n - at); // 1 = forward, -1 = back, 0 = (re)opening
    at = Math.max(0, Math.min(steps.length - 1, n));
    steps.forEach((s, i) => { s.hidden = i !== at; });
    [...dots.children].forEach((d, i) => {
      d.classList.toggle('on', i <= at);
      d.classList.toggle('cur', i === at);
    });
    // next slides the new step in from the right, back from the left
    if (dir && motionOK()) {
      steps[at].animate([{ opacity: 0, translate: `${dir * 28}px 0` }, { opacity: 1, translate: '0 0' }],
        { duration: 280, easing: 'cubic-bezier(.2, .8, .3, 1)' });
    }
    const last = at === steps.length - 1;
    $('#setup-back').hidden = at === 0;
    $('#setup-next').hidden = last;
    $('#setup-skip').hidden = last;
    $('#setup-next .t').textContent = at === 0 ? "let's go" : 'next';
    if (steps[at].dataset.step === 'board') preview.render();
    card.scrollTop = 0;
    (last ? dlg.querySelector('.start') : $('#setup-next')).focus();
  }

  function open() {
    if (dlg.open) return;
    preview.game = new Chess();
    preview.reset();
    preview.render();
    dlg.showModal();
    at = 0;
    show(0);
  }

  // fades out (dialog + backdrop), then closes. the page underneath already shows the picked tab
  let closing = false;
  function finish(tab) {
    if (closing || !dlg.open) return;
    setSetting('setupDone', true);
    preview.reset(); // drops a half-finished drag or an open promotion picker
    if (tab) $(`nav [data-tab="${tab}"]`).click();
    if (!motionOK()) return dlg.close();
    closing = true;
    const opts = { duration: 200, easing: 'ease-in', fill: 'forwards' };
    const anims = [card.animate([{ opacity: 1 }, { opacity: 0, translate: '0 10px', scale: '.98' }], opts)];
    try { anims.push(dlg.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, pseudoElement: '::backdrop' })); } catch { /* no backdrop animation */ }
    const done = () => {
      dlg.close();
      anims.forEach((x) => x.cancel()); // drop the faded-out end state so the next open starts clean
      closing = false;
    };
    anims[0].finished.then(done, done);
  }

  $('#setup-next').addEventListener('click', () => show(at + 1));
  $('#setup-back').addEventListener('click', () => show(at - 1));
  $('#setup-skip').addEventListener('click', () => finish());
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); }); // escape = skip
  dlg.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.go)));
  $('#setup-again').addEventListener('click', () => { $('#settings-close').click(); open(); });
  // click twice ("sure?"); reloading is the simplest way to put every control back to its default
  confirmButton($('#settings-reset'), () => { resetSettings(); location.reload(); });

  if (!settings.setupDone) open();
}

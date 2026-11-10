# ampersand

play it: **https://zizies.github.io/ampersand/**
or: **https://ampersand-gules.vercel.app/**

chess in the browser. static page, no build step, plain js + es modules. hosted on github pages straight from `main` (the empty `.nojekyll` file tells pages to serve the files as-is).

## run locally

```sh
python -m http.server 8642
```

open http://localhost:8642. es modules won't load from `file://`, so it needs to be served. everything it needs is in the repo (no CDNs), so it also works on networks that block them; only the Inter font comes from google fonts, and it falls back to the system font.

## what's here

- **local**: pass-the-device play with an optional clock, undo, flip, resign
- **pgn**: paste a pgn, step through with buttons or click moves in the list, copy it back out
- **online**: manual webrtc: host makes a code, sends it to a friend (discord etc), friend pastes it and sends back a reply code, host pastes that, board appears. no servers, data flows peer-to-peer. host is white and picks the time control.
- **bot**: rating slider from 400 to "max". under 1320 it's a homemade beginner engine (`js/beginner-worker.js`) that misses threats and grabs material like a real beginner; from 1320 up it's stockfish 19 limiting itself to that elo; max = stockfish with no limits. hints (green arrow), eval bar, takebacks, premoves, clocks, and a game review afterwards (accuracy, inaccuracies/mistakes/blunders, eval graph, best-move arrows). the engine runs in web workers and only loads once you press play.
- **bot vs bot**: the switch at the top of the bot panel. pick a strength for each side (same 400 to max range, so you can watch a beginner bot get crushed by stockfish, or stockfish play itself), a speed (slow / normal / fast) and a clock, then watch. pause, resume, flip, and the same game review when it ends.

on every board: drag or click to move, right-drag for arrows (shift/alt/ctrl = red/blue/green), right-click a square to circle it. online you can premove during the opponent's turn (right-click cancels). the gear opens settings: auto-queen, premoves, legacy castling (king onto rook), legal-move dots, board colors (coral by default; buttons and toggles take a matching accent color), coordinates, animation. saved in localStorage. "reset settings" (click twice) clears them and starts over like a first visit.

first visit opens a short setup: pick a board (with a preview you can move pieces on), the move options, then where to start. "skip setup" or escape keeps the defaults, and settings has "run setup again".

## credits

- chess pieces: cburnett set by [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), via [lichess](https://github.com/lichess-org/lila), [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)
- ui icons + logo knight: [lucide](https://lucide.dev) v1.70.0, ISC license
- font: [Inter](https://rsms.me/inter/) via google fonts, OFL license
- engine: [Stockfish](https://stockfishchess.org) 19 via [stockfish.js](https://github.com/nmrugg/stockfish.js) (lite, single-threaded wasm), GPL-3.0, see `engine/Copying.txt`. the files in `engine/` are unmodified copies from the [stockfish npm package v19.0.1](https://www.npmjs.com/package/stockfish/v/19.0.1); source code is at [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) and [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish)
- move rules: [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 by Jeff Hlywa, BSD-2-Clause, see `vendor/chess.js/LICENSE`. `vendor/chess.js/chess.js` is the unmodified `dist/esm/chess.js` from the npm package

## license

[GPL-3.0](LICENSE). the bundled stockfish engine is GPL-3.0 and the piece set is GPLv2-or-later, so the whole project uses GPL-3.0 to keep everything compatible.

## files

```
index.html
style.css
js/app.js       tabs, local mode, online mode, settings drawer
js/board.js     board view + input: drag/click, premoves, arrows, promo picker, animation
js/clock.js     chess clock + time controls
js/settings.js  preferences (localStorage) + board themes
js/pgn-mode.js  pgn parse/stepper
js/net.js       webrtc layer (code encode/decode, conn lifecycle)
js/match.js     you-vs-someone game controller shared by online + bot
js/bot.js       bot move choice, analysis engine, game review
js/engine.js    stockfish uci wrapper (web worker) + score helpers
js/beginner-worker.js  homemade beginner engine (module worker)
engine/         stockfish 19 lite wasm + license
vendor/chess.js chess.js 1.4.0 (move rules) + license
pieces/         svg piece set (wK.svg … bP.svg)
```

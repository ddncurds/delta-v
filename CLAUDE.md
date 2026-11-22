# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Delta-v («Дельта-v») is a browser game: tactical ship combat in empty space with Newtonian physics, gravity wells, torpedoes and flak. It's plain JavaScript ES modules with a Canvas 2D renderer. There is no bundler, no npm dependencies and no linter. Code comments, test names and Makefile help are in **Russian**, so keep new comments in Russian too. The UI defaults to English.

## Commands

- `make run` (or `npm start`): rebuilds `offline.js`, then serves the game at http://localhost:8080 with `Cache-Control: no-store` (`scripts/serve.mjs`). Use `make run PORT=3000` for another port. Don't use `python -m http.server`, because Chrome then caches stale ES modules.
- `make test` / `npm test`: runs all tests (`node --test tests/*.test.js`).
- Single file: `node --test tests/ship.test.js`. Single test: `node --test --test-name-pattern="<regex>" tests/ship.test.js`.
- Test groups: `make test-sim`, `make test-net`, `make test-e2e`, `make test-ui`.
- `make check`: runs `node --check` over every JS file. `make ci` = check + test.
- `make offline`: regenerates `offline.js`.

## offline.js is generated

`offline.js` is built by `scripts/offline.mjs` and is committed. Don't edit it by hand. It packs every module's source so the game runs from `index.html` opened as `file://`, where browsers refuse to load ES modules. **After changing any file under `src/`, run `make offline`.** Otherwise `tests/offline.test.js` fails because the file is stale. The builder only handles static relative imports. It rejects `import()`, `import.meta` and circular imports in `src/`.

## Architecture

The entry point is `src/main.js`. It wires the modules together and runs the loop: a fixed-step simulation (`DT` = 0.05 s from `src/config.js`) scaled by time speed, then rendering.

- **`src/sim/`**: pure simulation with no DOM. It runs in Node, and the tests drive it directly. `index.js` is the public API. All battle state lives in the single object `S` (`state.js`), exported as a live binding `export let S`. `newGame()` replaces `S` wholesale, so always read `S` through the import and never cache it. Ship id = its index in `S.ships`, and `S.myId` is the locally controlled ship. `world.js` `step(dt)` runs the order AI → delayed orders → ship physics → sensor tracks → torpedoes → flak pellets → plumes → end check.
- **Sensors/fog of war**: ships and the AI act on per-observer tracks (`S.tracks[observer][target]`, `sensors.js`), not true enemy positions. Engine burns (`accG`) reveal a ship.
- **Messages are keys, not text**: the sim emits crew messages with `sayTo(id, key, params)`. Results are stored as `[key, params]`. `main.js` translates them for the local ship. The host forwards keys to guests, and each guest translates them into its own language. Never put display strings in sim code. Add keys to both `src/i18n/en.js` and `src/i18n/ru.js`. `t()` in `src/i18n.js` supports `{x}`, `{x|d}` (distance) and `{x|s}` (seconds).
- **Balance/config**: all tunables are in `src/config.js`, in SI units (m, s, m/s). Fuel is expressed as Δv.
- **`src/net/`**: multiplayer over MQTT (flespi broker; the library is loaded at runtime from unpkg). `transport.js` holds the topics and connection, `multiplayer.js` the lobby, host and guest logic, and `snapshot.js` the per-guest snapshots. The **host is authoritative**: it runs the full sim and the AI. Each guest gets a filtered snapshot of what its own ship can see (`SHIP_FULL` vs `SHIP_PUB` fields). Between snapshots the guest extrapolates with `guestStep`. Guests send orders, and guests don't create AI.
- **Roster** (`src/roster.js`): 2×`TEAM.max` slots (`off`/`ai`/`human`), turned into a `newGame({ roster })` roster. Team 0 is blue and team 1 is red.
- **`src/render/`**: Canvas renderer. `scene.js` draws the frame, and helpers cover LOD, labels, glow, fx and trails. All colors are defined in `theme.js` (for CSS, `:root` in `styles/main.css`). Don't hardcode color strings in the drawing code.
- **`src/ui/`, `src/session.js`, `src/run.js`**: HUD, controls, overlay, and the battle start and end. `run` holds session flags (started, paused, chosen and current time scale).

## Tests

All tests use `node:test` with no browser:
- Sim tests use `tests/helpers.js` (`emptySpace`, `runFor`, `putTorp`, …) to set up scenarios.
- UI tests load the real modules against `tests/dom-stub.js`, a minimal DOM built from the element ids in the real `index.html`. Adding or renaming ids in `index.html` affects them.
- Tests that assert Russian strings import `tests/lang-ru.js` to switch the language.
- Network tests use `tests/fake-mqtt.js`, an in-memory broker exposed as `window.mqtt`. `mp-e2e.test.js` runs a host and two guests as separate worker threads (`tests/e2e/`) that drive the UI through the broker.

## Plans

`plans/` holds the specs (in Russian) for upcoming work: `ai.md` (AI improvements) and `plan_graffics.md` (graphics).

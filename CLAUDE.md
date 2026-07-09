# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LiveBoard: a real-time collaborative whiteboard for OBS live streams (Node/Express + Socket.IO backend, Fabric.js frontend). Multiple moderators draw/type/paste images on a shared board; everything syncs live to a transparent-background OBS browser source with minimal latency. Docs and comments are in Portuguese.

**Zero-build project.** No Webpack/Vite/Babel/TypeScript. Server runs directly via `node --env-file=...`. Client is native browser ES Modules (`<script type="module">`) plus a couple of intentional classic `<script>` files — there is no bundler and no transpilation step, ever.

## Commands

```bash
npm start        # production: node --env-file=.env server/index.js
npm run dev       # development: node --env-file=.env-dev server/index.js (port 3000, password live123)
npm test          # automated tests — see TESTING.md
npm run test:e2e  # Playwright E2E (slower, not part of `npm test`) — see TESTING.md
```

There is no lint/typecheck/build script. Node v18+ is required (uses native `--env-file`).

### Automated tests — see `TESTING.md`

Full details (what each layer covers, how to run a subset, known gaps, and a
data-isolation gotcha you must respect when adding server integration tests)
are in `TESTING.md`. Summary of the 4 layers:

1. **`test/server/unit/`** — pure-logic unit tests for `server/services/`+`server/utils/` (`node --test`).
2. **`test/server/integration/`** — boots a real `server/index.js` + real `socket.io-client`, exercises the actual wire protocol end-to-end (object CRUD, undo/redo, persistence).
3. **`test-harness/`** — `import-test.mjs` imports the entire `public/js/board-app.js` module graph under mocks (`mocks.mjs`) and fires ~25 real socket events at it, with state assertions (not just "didn't throw"); `test-harness/unit/*.test.mjs` covers `serialization.js`/`group-service.js`/`event-bus.js` in isolation. This layer specifically catches two classes of bugs plain syntax checks miss:
   - **TDZ / circular-import errors** ("Cannot access 'X' before initialization") — a top-level `const`/`socket.on(...)` registration reading a binding imported from a module that imports back from it.
   - **Missing export/import** ("X is not defined") — a helper used across two files but never actually `export`ed/`import`ed; only surfaces when the handler that uses it actually runs.
4. **`test/e2e/`** (Playwright) — real Chromium against a real server: login, drawing, layers, groups, upload, undo/redo, multi-tab collaboration, `/view` route.

**Run `npm test` after any change that touches `public/js/**` module boundaries** (new exports, new circular imports, new socket listeners) — layer 3 exits non-zero on `ReferenceError`.

`CHECKLIST.md` still has a 19-step manual QA script for what the automated layers can't reach (real OS clipboard paste, drag-and-drop) — run relevant parts of it after non-trivial client changes.

## Architecture

### Server (`server/`) — Express + Socket.IO, in-memory state with disk persistence

- `index.js` — bootstrap only (~70 lines): creates app/http/io, wires middleware/routes/sockets, starts background maintenance. Put new wiring here, not new logic.
- `config.js` — constants (port, password, limits, paths).
- `routes/` — one file per HTTP route group (`auth`, `upload`, `api`, `pages`).
- `sockets/` — one file per socket.io event group (`drawing`, `groups`, `history`, `layers`, `lifecycle`, `objects`, `viewport`); `sockets/index.js` registers them all.
- `services/` — business logic, repository-style (`room.service.js`, `upload.service.js`).
- `utils/` — pure helpers (`slugify.js`, `files.js`).

Key behaviors to know before touching server code:
- **State is volatile by design.** On every startup, `server/index.js` deletes everything in `uploads/` and `data/rooms/`. Room state elsewhere is saved to `data/rooms/<slug>.json` 2s after any change and restored on next start of that room (as long as the server wasn't restarted since).
- Empty rooms are evicted from RAM+disk after 30 minutes idle (`room.service.js` eviction sweep).
- Z-order is a persisted `zorder` array per room, not implicit in objects — restore it exactly on undo/redo/reconnect.
- Undo/redo keeps up to 50 full snapshots per room (objects + layers + zorder together), not diffs.
- Group/ungroup are atomic server operations: one `pushUndo` per operation; clients reuse existing Fabric objects instead of destroy+recreate.

### Client (`public/js/`) — ES Modules, feature-folder structure

```
public/js/
├── shared/     → code used by 2+ pages (fabric monkey-patches, socket-client factory)
├── core/       → canvas-manager (creates the fabric.Canvas), event-bus, serialization (ser/deser)
├── features/   → one folder per feature: clipboard, drawing-tools, export, groups, layers,
│                 live-bg, media (GIF), onboarding, remote-users, spawn-area
├── ui/         → panel-layout, selection-toolbar, room-controls
├── board-app.js  → entrypoint for board.html — the hub: mouse/touch dispatcher, socket
│                   wiring, and the window.* bridge for inline onclick handlers
├── view-app.js   → entrypoint for view.html — independent read-only OBS client
└── index-app.js  → entrypoint for index.html — login + tutorial
```

**`board-app.js` is the hub, not a god file to keep shrinking blindly.** The mouse/touch dispatcher (`canvas.on('mouse:move'/'down'/'up')`, pan, wheel/touch handling) intentionally stays there because it's shared across drawing tools, selection, and the spawn-area feature — it doesn't belong to any single feature module.

**The circular-import pattern is deliberate and safe, under one rule.** Most feature modules import things back from `board-app.js` (`socket`, `vpRect`, helper functions, etc.) even though `board-app.js` imports the feature module. This works in ES Modules **only if the circularly-imported binding is never read at module top level** — only inside function bodies that run later (event handlers, callbacks). Two concrete corollaries:
- If a module needs to register `socket.on(...)` listeners and `socket` comes from `board-app.js`, don't do it at module top level — export an `initXSocketListeners()` function and call it from `board-app.js` *after* `const socket = ...` has run (see `staging-area.js`'s `initStagingSocketListeners()`, `remote-users.js`'s `initRemoteUsersSocketListeners()`).
- A value derived from a circular binding (e.g. a localStorage key using `myRoomId`) must be computed lazily inside a function, never as a top-level `const`.
- A binding imported from another module can't be reassigned, only mutated (e.g. `export const boardLayers` mutated via `.length = 0; .push(...)`, never `boardLayers = newArray`) — or exported via an explicit setter function if reassignment is genuinely needed (see `setPenActive`, `setStagingAreaEntries`).

Violating any of this reintroduces exactly the bugs documented in `ARCHITECTURE.md` (TDZ crashes, `ReferenceError` on unexported helpers) — always run `npm run test:client` (or `npm test`) after touching module exports/imports or adding new circular references.

`board.html`/`view.html`/`index.html` are markup only; all logic lives in the corresponding `*-app.js`. Inline `onclick`/`onchange`/`oninput` attributes call functions exposed via an explicit `window.*` bridge at the bottom of `board-app.js`/`index-app.js` (ES modules don't leak top-level declarations globally like classic scripts do) — when adding a new inline-invoked function, remember to add it to that bridge.

`view-app.js` deliberately duplicates some logic from `board-app.js` (deserialization, GIF decode, `applyFull`/`loadState`) rather than sharing a module — the view is a separate, simpler read-only client with its own `fabric.Canvas` and no editing/selection concerns.

### Sync protocol (socket.io events)

Full event table is in `README.md` under "Arquitetura de sincronização" — key distinction: high-frequency events during a live drag/transform (`object:transform`, `objects:transform`) are sent `volatile` (droppable, no ack), while events that must land (`object:add`, `object:modify:commit`, `objects:batch`, `zorder:sync`, group/ungroup) are guaranteed and typically also push an undo state.

### GIF pipeline

GIFs decode off the main thread in `public/gif.worker.js` (fetches, parses GIF89a/87a, LZW-decodes, composites via `OffscreenCanvas` respecting 4 disposal modes), sends back `ImageBitmap[]` via zero-copy `postMessage`. A single global `requestAnimationFrame` loop in `features/media/gif-service.js` animates all active GIFs using real per-frame delays. GIFs cannot be grouped.

### Image loading

`fabric.Image.fromURL` is globally monkey-patched (`public/js/shared/fabric-image-patch.js`) on every client to cache `HTMLImageElement`s per session, normalize cross-host URLs to the current origin, force `crossOrigin: 'anonymous'` everywhere (including group children), and warm the HTTP cache via a raw `fetch` before creating the `<img>` — avoids tainted-canvas failures.

## Multi-room model

Rooms are independent (own objects/layers/undo-redo/z-order), identified by a URL slug derived from the room name (`server/utils/slugify.js`). `/view/:sala` is the per-room OBS source. The "spawn area" (`features/spawn-area/`) controls where pasted/new objects land per-user so nothing "pops" mid-stream; it's synced non-realtime (only on toggle/move/reconnect, not on every mouse move) and persisted per `clientId` (not username) in room state.

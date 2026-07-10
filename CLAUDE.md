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
- **Undo/redo is per-user, patch-based** (not global snapshots). Each user has their own `undoStack`/`redoStack` in `room.userHistory[userId]`, capped at `MAX_HISTORY` (30) entries; each entry is a *patch* holding only the before/after of the objects/layers/zorder the action touched (`pushUserAction` in `room.service.js`). `applyActionPatch` skips objects another user changed since (conflict detection). Applying an undo/redo broadcasts a **diff** (`history:apply` — only the affected objects + resulting zorder/layers), not the whole room state; the client routes each object through `applyFull` (cached images, GIF fast-path). History is per-session and never persisted to disk.
- Group/ungroup are atomic server operations: one `pushUndo` per operation; clients reuse existing Fabric objects instead of destroy+recreate.
- **The Socket.IO handshake is authenticated** (`sockets/index.js` `io.use`): `editor` clients must carry a valid `lb_session` cookie (same one the `/board.html` route checks); `view` clients (the OBS source) connect without auth but are read-only — the write handlers (`objects`/`groups`/`layers`/`history`/`drawing`/`viewport`) are only registered for editors, so a `view` socket can't mutate the board even by emitting events by hand.

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

### Responsive layout (desktop vs mobile)

`board.css` has one hard breakpoint at **768px**, mirrored in JS by `isMobileLayout()` in `ui/panel-layout.js`. Below it the layout **changes kind**, it doesn't just shrink: the toolbar moves to the bottom (thumb zone), `#ctx` becomes a bottom-sheet (collapsed = only the icon action row; the grabber expands the properties), and `#layers-panel`/`#vp-panel` become sliding drawers over a `#drawer-backdrop`.

Three rules that are easy to break:
- **`layoutSidePanels()` must bail out on mobile.** The desktop layout positions panels by writing *inline* `top`/`max-height` (measured via `getBoundingClientRect`), and inline styles beat the `@media` CSS. `layoutSidePanels()` therefore calls `clearDesktopInlineLayout()` and returns early when `isMobileLayout()`.
- **`body { touch-action: none }`** (needed so the canvas owns 1- and 2-finger gestures) also kills touch scrolling inside panels. Every scroll container re-enables its axis explicitly (`#layers-list`, `#ctx-props`, `#vp-content` → `pan-y`; `#toolbar`, `#opts` → `pan-x`).
- **No CSS `transition` on position/size for the *inputs* of the layout cascade** (`#toolbar`, `#opts`, `#spawn-panel`, `#top-left-panel`, `#users`). `layoutSidePanels()` positions each panel by measuring the previous one's real edge; `getBoundingClientRect()` returns the *current* frame of a running transition, not its end state, so the next panel gets placed where the previous one *was*. Nothing triggers a re-layout when the transition ends, so the error is permanent (this is what put the view/pencil buttons on top of `#vp-panel`). The *outputs* (`#ctx`, `#layers-panel`, `#vp-panel`) may animate freely — nothing measures them.

`updTopLeftPanelPos()` decides whether to drop the corner panel below the toolbar by **measuring the actual collision**, not by a width breakpoint: the width at which they touch depends on how many buttons the toolbar has and on the label text. Environment-driven triggers (`resize`, `ResizeObserver`, `document.fonts.ready`) are coalesced into one `requestAnimationFrame` (`scheduleLayout()`); intent-driven ones (`updCtx`, tool change, panel toggle) call `layoutSidePanels()` synchronously because they need the result in the same tick.

Touch targets are enforced under `@media (pointer: coarse)` (not by width — a large touch tablet needs them too).

On mobile the toast moves to the top (the footer became the toolbar), where `#spawn-panel` also lives centered — keep them from overlapping (`#toast { top: 118px }` clears the panel's `64px + 44px` under coarse pointer).

### Multi-seleção (fabric.ActiveSelection) e updates vindos do servidor

Children of a `fabric.ActiveSelection` store `left`/`top` **relative to its center**, and `canvas.remove(obj)` does **not** pull the object out of the selection's `_objects` (Fabric only discards the selection if the removed object *is* the whole `activeObject`). Since `applyFull()` removes and recreates the object, applying any update to an object inside the active selection strands the old one — still drawn by the selection, with relative coords read as absolute (a ghost rectangle off in a corner) — while the recreated one enters the canvas loose, and the selection's bounding box is never recalculated.

So every socket handler that touches existing objects (`object:add`/`modify`/`remove`, `objects:batch`, `history:apply`) goes through **`withSelectionSafe(ids, fn)`** in `board-app.js`: discard the selection, run `fn`, rebuild it from the ids afterwards (waiting on `loadingNow` for images). `history:apply` is the critical one — it's the only event the server sends with `toRoom` (it comes back to the author of the Ctrl+Z, i.e. exactly the person holding the selection); the others use `bcast` and only reach *other* clients.

Corollary: `applyTransformOnly()` returns early when `obj.group` exists. Writing absolute coords into a selection child teleports it; the live `object:transform` is volatile and the following commit fixes the position.

Regression covered by `test/e2e/board.spec.js` ("undo com multi-seleção ativa não deixa objeto órfão").

### Clipboard

There is an **internal clipboard** (`features/clipboard/clipboard.js`): copying always stores the serialized objects in memory + `localStorage` (`lb_clipboard`), and `pasteFromClipboard()` reads from it. This is the only path that works on touch — `navigator.clipboard.write` with an image `ClipboardItem` is blocked on many mobile browsers, and the `paste` event needs Ctrl+V. The system clipboard is still written in parallel (best-effort, failure only logged) so you can paste into other apps on desktop. `copySel`/`pasteFromClipboard`/`dupSel` are all exposed as buttons (`#ctx-actions`, `#t-paste`), not just keyboard shortcuts.

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

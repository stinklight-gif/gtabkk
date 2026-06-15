# Goal 3: HUD / map & objective pass

Surface the things a player now needs to navigate to — **Home**, the **Garage**,
the **current objective**, and what's on the **radio** — on the always-on HUD,
not just buried in text. Written after a runtime audit of the current HUD,
minimap, and full-map code. All line numbers were verified against the modular
build (post ES-module split); re-grep before editing, they will drift.

The work lives in `hud.js` (minimap + a new waypoint method), `main.js`
(`drawFullMap`, `updateRadio`), and `index.html` (HUD DOM + CSS). `window.GAME`
stays stable; every module already imports `* as THREE from 'three'`.

---

## What exists today (verified)

- **Minimap** — `hud.js` `drawMinimap(player)` (≈ lines 92–158). Rotates with
  camera yaw, centers on the player, zoom cycles via **N**. Already plots the
  active **mission** marker (gold), the **taxi** marker (gold/green), uncollected
  **amulets**, the **snatcher** (orange), and **cops** (red), plus a player blip
  and the compass. World→minimap scale is `256/(HALF*2)` ≈ 0.512 px/m. Markers
  are drawn **inside** the `save()/translate(128,128)/rotate(-camRig.yaw)/
  scale(minimapZoom)` block; the player blip + compass come **after** `restore()`.
- **Full map / TAB** — `main.js` `drawFullMap()` (≈ 551–595). Scaled minimap base
  + **text labels** that already include `Home`/`Safehouse` and `Garage`/
  `U-Spray` (state-aware via `G.econ.safehouse.owned` / `G.econ.garage.rented`),
  amulet dots, mission/taxi/cop dots, and the player heading line.
- **Objective data** — `G.mission.active.markerPos` (set per stage in
  `missions.js`) and `G.taxi.markerPos` / `G.taxi.stage`. A 3D "pillar of light"
  beam stands at markers, but there is **no on-screen waypoint** (no distance, no
  off-screen arrow).
- **Radio** — `G.audio.radio` exposes `station` (index), `names[]`, and `next()`.
  `updateRadio` (main.js) flashes the station name via `showNotif` on car
  entry/cycle, but there is **no persistent HUD chip**.
- **HUD DOM** — `index.html` `#hud` (≈ 242–286): corners for stars/cash,
  `#minimap-wrap` + `#compass` (top-right), bars, ammo; plus `#clock`,
  `#weather-tag`, `#subtitle`, `#prompt`, `#notif`. The camera is `G.camera`
  (a `PerspectiveCamera`) — usable to project world points to screen.

**The gaps:** Home/Garage have no *minimap* icon (only TAB text); there is no
on-screen objective waypoint with distance + arrow; there is no radio chip; the
TAB map has no legend or objective line.

---

## Phase 1 — Home / Garage / objective icons on both maps

- **Minimap** (`hud.js drawMinimap`, **inside** the rotated transform, before
  `mctx.restore()`): add an `mm(p)` helper returning
  `[(p.x+HALF)*SCALE - ppx, (p.z+HALF)*SCALE - ppy]` and draw:
  - [ ] **Home** at `G.world.poi.safehouse` — a small house glyph (square +
    triangle roof). Filled cyan/green when `G.econ.safehouse.owned`, hollow
    outline while it's still for sale.
  - [ ] **Garage** at `G.world.garages[0].pos` — a small box/wrench glyph.
    Filled blue when `G.econ.garage.rented`, hollow as U-Spray.
  - Keep both inside the `save()…restore()` block so they translate + rotate with
    the map exactly like the existing dots.
- **Full map** (`main.js drawFullMap`): draw the same glyphs just above the
  existing Home/Garage labels, and thicken the active-objective ring so it reads
  as the primary target.
- **Acceptance:** Home + Garage are visible and state-coded on the always-on
  minimap and on the TAB map.

## Phase 2 — On-screen objective waypoint (the headline)

- [ ] **DOM/CSS** (`index.html`): a `#waypoint` pill (arrow `▲` + label + distance),
  absolutely positioned over the canvas, hidden by default; styled to match the
  HUD (cream text, subtle backdrop).
- [ ] **Logic** — a new `hud.js` method `drawWaypoint()` called each frame from
  the loop, gated on `G.state === 'playing'`:
  - Target = `G.mission.active?.markerPos`, else `G.taxi.stage !== 'idle'
    ? G.taxi.markerPos : null`. Hide the pill when there is no target.
  - Project with a pooled `_wp = new THREE.Vector3()`: copy target (+ ~2 m y),
    `_wp.project(G.camera)` → NDC. Convert to pixels.
  - **On-screen** (in front + within bounds): place the pill at the projected
    pixel, clamped to a screen margin; hide the arrow; show
    `Math.round(playerHorizDist) + ' m'`.
  - **Off-screen** (behind the camera or outside bounds): clamp the pill to a
    screen-edge rectangle and rotate the arrow via `atan2` of the screen-space
    direction so it points toward the marker.
  - Color the pill to match the marker (mission pink/gold, taxi green).
- **Acceptance:** with a mission active, the pill shows the objective name + a
  live distance; when the marker is off-screen the arrow points to it and tracks
  as you turn/drive; it hides when there's no objective. (Complements, doesn't
  replace, the 3D beam.)

## Phase 3 — Radio chip

- [ ] **DOM/CSS** (`index.html`): a `#radio-chip` pill near the minimap.
- [ ] **Logic** (`main.js updateRadio`): while `p.inVehicle` and `station !== 0`,
  show `📻 <name>` and update it on cycle; hide it on foot or when the station is
  `RADIO OFF`. Reuses the existing in-vehicle transition tracking; keep the
  entry/cycle `showNotif` flash.
- **Acceptance:** enter a car → the chip shows the current station; **M** cycles
  it live; it disappears on foot and at RADIO OFF.

## Phase 4 — TAB-map legend + objective line + polish

- [ ] In `drawFullMap`: a small color-key legend (home / garage / objective /
  cops / amulet) and a bottom `Objective: <name> — <distance>` line; tidy the
  label spacing so glyphs and text don't collide.
- **Acceptance:** the TAB map reads clearly to someone who's never seen it.

## Phase 5 — Verification

- [ ] New `node_modules/hud_test.mjs` probe: set
  `GAME.mission.active = { markerPos: new THREE.Vector3(...) }`, assert
  `#waypoint` is visible with sane distance text; rotate the camera away and
  assert the arrow angle flips toward the marker; enter a vehicle and assert
  `#radio-chip` shows the station and changes on **M**; sample minimap-canvas
  pixels at the Home/Garage icon positions to confirm they render.
- [ ] Extend `tools/smoke.mjs` with a waypoint-and-chip shot (mission set, in a
  car) and a TAB-map shot; CI (`.github/workflows/smoke.yml`) uploads them.
- **Acceptance:** the probe and `smoke` are green; the screenshots show the
  waypoint, the radio chip, and the map icons.

---

## Engineering guardrails

1. **Modular placement.** Minimap icons + waypoint → `hud.js`; radio chip →
   `main.js updateRadio`; TAB map → `main.js drawFullMap`; DOM/CSS →
   `index.html`. Nothing new on `window.GAME` except, if needed, a pooled
   scratch vector inside `hud.js`.
2. **Respect the minimap transform.** Map icons go *inside* the
   `save()/rotate(-yaw)/scale(zoom)` block (before `restore()`) so they rotate
   with the map; screen-fixed HUD (player blip, compass, waypoint pill) lives
   after `restore()` / in the DOM.
3. **Projection is only valid in front of the camera.** `Vector3.project()`
   returns flipped/garbage NDC for points behind the camera. Detect behind-camera
   (camera-space z ≥ 0, or `dot(target − camPos, cameraForward) < 0`) and route
   to the off-screen-arrow path instead of trusting the NDC.
4. **Don't draw the waypoint when the HUD is hidden** (photo mode, `state` not
   `'playing'`) or while paused.
5. **Harness boots via the save-slot menu now** — scripts click the first
   `#slots button`, not `#startbtn`. A waypoint shot just sets
   `GAME.mission.active.markerPos` + a camera, then screenshots.
6. **No build step.** Everything stays "serve the folder and it runs."

---

## Done definition

From the HUD alone — without reading the README — a player can see where **Home**,
the **Garage**, and their **current objective** are (minimap icons + an on-screen
waypoint with live distance + a legible TAB map with a legend) and what's playing
on the **radio** while driving. A `hud_test` probe and the `smoke` harness are
green, with screenshot artifacts showing the waypoint, the chip, and the map
icons.

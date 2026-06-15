# Goal 4: Enter Terminal 21 — a walkable mall interior at Asok

Give the player a real **destination they can go inside**: the Terminal 21
mall at the Asok BTS interchange. Walk up to the entrance, press **E**, and
you're standing in the atrium — escalators, a directory, and themed shop fronts
you can browse (Terminal 21's gimmick is that each floor is a world city:
Rome, Paris, Tokyo, San Francisco…). This is the first **interior** in the
game, so most of the work is the enter/exit transition and making the outdoor
systems behave while you're inside.

Written after a runtime audit of the world-build, landmark, store-overlay, and
state-machine code. Line numbers were verified against the current modular
build but **re-grep before editing — they drift.**

The work lives in `worldLandmarks.js` (the mall exterior + interior geometry),
`player.js` (`updateInteraction` enter/exit + a new `updateMall`), `main.js`
(a new `'mall'`/interior state branch in `loop`, overlay button wiring),
`index.html` (entrance prompt reuse + an optional directory overlay), and
`hud.js` / `main.js drawFullMap` (a mall map icon, reusing Goal 3's glyph
helpers). `window.GAME` stays stable.

---

## What exists today (verified)

- **Landmark pattern** — `worldLandmarks.js` builds each landmark as a
  `THREE.Group`, `scene.add()`s it, registers a collision AABB via
  `world.buildings.push({ pos, size })`, and exposes a POI via `world.poi.X`
  (see the gold shop ≈ lines 319–336, now solid after Goal "on-foot physics").
  The baker (`core.js makeStaticBaker`) is for *provably-static* city geometry;
  landmark groups are added directly to the scene, which is what an interior
  wants too.
- **Asok BTS** — the Skytrain station is centered at `sx = -50`, the line runs
  along `z ≈ 0`, `stationFloorY = 13.6` (`worldLandmarks.js` ≈ 202–241). Real
  Terminal 21 sits right on the Sukhumvit/Asok corner wired into this station —
  so the mall belongs in a block adjacent to `(-50, 0)`. **Pick a block that
  isn't already a landmark** (temple block is `TEMPLE_I/J` in `world.js` ≈ 402–
  412; gold shop at `(-160,-160)`; garage/safehouse via `worldLandmarks`) and
  verify it's clear before placing.
- **Store overlay flow** — the reusable "shop UI" precedent: `update7Eleven`
  (`player.js` ≈ 192–203) sets `G.state = 'store'` and shows `#store`
  (`index.html` ≈ 323–336); buttons are wired in `main.js` via `sbind`
  (`buy-snack`/`buy-drink`/`buy-vest`/`store-leave` ≈ 434–437); `storeBuy(item)`
  applies the purchase (`player.js` ≈ 242). The loop has a dedicated
  `else if (G.state === 'store')` branch (`main.js` ≈ 808).
- **State machine** — `loop()` (`main.js` ≈ 688–810) runs the world only while
  `G.state === 'playing'` and has parked branches for `phone`/`map`/`paused`/
  `dead`/`photo`/`options`/`store`. Toggling overlays follows a fixed pattern:
  set `G.state`, add/remove a `.show` class, `document.exitPointerLock()` /
  `G.input.requestLock()`.
- **Enter/exit precedent** — `updateInteraction` (`player.js` ≈ 160–189) finds
  the nearest enterable thing and acts on **E**; the garage (`vehicles.js`)
  already teleports the player between an outside door and an inside spot. The
  safehouse buy uses the same proximity-prompt shape.
- **HUD map icons (Goal 3)** — `hud.js` exports `drawHouseGlyph`/
  `drawGarageGlyph` + `HOME_COLOR`/`GARAGE_COLOR`, the minimap has an `mm(p)`
  helper inside its rotated transform, and `drawFullMap` (`main.js`) has a
  legend + objective line. A mall icon slots straight into both. The on-screen
  waypoint already targets `G.mission.active.markerPos` / `G.taxi.markerPos`.
- **District banner** — `updateDistrict` (`player.js` ≈ 99–112) names zones by
  position; there's no "Asok" yet.

**The gap:** there is **no interior anywhere** — every building is a solid box.
Nothing to enter, no inside space, no per-shop UI beyond the 7-Eleven/garage.

---

## Design — how an "interior" works without a second scene

The renderer draws one `G.scene` with one `G.camera`; there's no portal system.
Build the mall interior as **real geometry parked in an unused pocket of the
world** (recommended: a walled room centered high above the map, e.g.
`INTERIOR_ORIGIN = (220, 400, 220)` — far from anything, never seen from the
street) and **teleport** the player in/out:

- `G.interior` (new, on `window.GAME`): `null` outdoors, `'terminal21'` inside.
- **Enter:** stash `G.player._exitPos` = current outdoor pos, move
  `player.group.position` to the interior spawn, set `G.interior`, snap the
  camera. **Exit:** reverse it.
- **While inside,** outdoor systems must not fight the player: gate
  ped/traffic/wanted spawning and recycling on `!G.interior` (they key off
  `G.player.group.position`, which would otherwise spawn a crowd at y=400), and
  switch the minimap/compass to an interior-appropriate readout (or hide them).
  The interior has its own small set of standing "shopper" peds.
- Interior collision reuses `world.buildings` AABBs (walls/units), so the
  existing `resolvePlayerVsBuildings` already keeps the player inside.

This keeps "serve the folder and it runs" — no engine changes, no second scene.

---

## Phase 1 — Terminal 21 exterior at Asok

- [ ] In `worldLandmarks.js`, build a distinctive mall **exterior** on a clear
  block beside the Asok BTS (~`(-50, ±50)`): a tall blocky tower over a wider
  podium, a bright **"Terminal 21"** sign plane, and a glassy **entrance bay**
  on the street-facing side with a doormat/marker. Register the podium footprint
  in `world.buildings` (solid, like the gold shop) **but leave a gap / no AABB
  at the entrance** so the door is walkable.
- [ ] `world.poi.terminal21 = <entrance Vector3>` (the stand-here spot, like
  `poi.safehouse`). Add a soft accent light + optional pillar-of-light marker.
- [ ] `updateDistrict`: add an **"Asok / อโศก"** zone around the mall so crossing
  in banners it.
- **Acceptance:** the mall is visible from the Asok BTS, is solid, and you can
  walk up to a clearly-marked entrance.

## Phase 2 — Enter / exit transition (the headline)

- [ ] **DOM/CSS** (`index.html`): reuse the prompt pattern — at the entrance,
  `showPrompt('Press <b>E</b> to enter <b>Terminal 21</b>')`. Add a brief
  fade-to-black `#fade` div (CSS opacity transition) for the transition so the
  teleport doesn't pop.
- [ ] **Interior geometry** (`worldLandmarks.js`): build the atrium room at
  `INTERIOR_ORIGIN` — floor, ceiling, surrounding walls (all registered in
  `world.buildings`), an open central well with **escalator** props, an
  info/directory desk, warm interior lighting, and 4–6 **shop-unit storefronts**
  (signage + a counter) spaced around the floor. Store an array
  `world.mall = { origin, spawn, exitDoor, shops:[{pos, kind, name, themeCity}] }`.
- [ ] **Logic** (`player.js`): in `updateInteraction`, when on foot near
  `world.poi.terminal21` and **E** is pressed → `enterMall()`; add a new
  `updateMall(dt)` (called from the loop while `G.interior`) that handles the
  exit door (**E** near `world.mall.exitDoor` → `exitMall()`), the per-shop
  prompts, and keeps the interior shoppers alive.
- [ ] **State/loop** (`main.js`): gate outdoor spawners on `!G.interior`; run
  `updateMall` while inside; make the **minimap** draw an interior floor-plan (or
  hide it) when `G.interior`. Keep `G.state === 'playing'` inside (movement,
  collision, camera all still apply) — `G.interior` is an orthogonal flag.
- **Acceptance:** **E** at the entrance fades in to the atrium; you can walk
  around inside against solid walls; **E** at the exit returns you to the Asok
  street exactly where you left, with traffic/crowd intact.

## Phase 3 — Shops inside

- [ ] Reuse the `#store` overlay shape for shop UIs. Each `world.mall.shops`
  entry is a proximity trigger (`updateMall`): near a unit →
  `showPrompt('Press <b>E</b> to browse <b>{name}</b>')`; on **E** →
  open that shop's overlay (a new `G.state` like `'shop'`, or reuse `'store'`
  with a per-shop item list). Wire buttons via `sbind` and an extended
  `storeBuy` (or a new `shopBuy`) so purchases actually spend `G.cash` and grant
  the item (snacks/armor/clothing-as-cosmetic/etc.).
- [ ] At least: a **food court** (HP/stamina like 7-Eleven), a **clothing**
  shop (cosmetic or a small buff), and an in-mall **7-Eleven** (reuse existing
  items). Keep it to 3–4 working shops; the rest can be flavor fronts.
- **Acceptance:** walking the atrium, each shop front prompts; **E** opens a
  themed menu; buying spends cash and applies the effect; leaving returns you to
  the floor.

## Phase 4 — Mall on the maps + polish

- [ ] **Map icons** (`hud.js` minimap + `main.js drawFullMap`): add a **mall**
  glyph (e.g. a storefront/▦) at `world.poi.terminal21`, reusing Goal 3's glyph
  + legend plumbing; draw it on the minimap base too (`world.js makeMinimapBase`,
  like Yaowarat ≈ 732). Add "Mall" to the TAB legend.
- [ ] **Theming** (`worldLandmarks.js`): label the shop zones with Terminal 21's
  city themes (Rome/Tokyo/Paris/SF) via signage colors/text; add ambient mall
  audio (a soft loop or chatter via `G.audio`), and shopper peds.
- [ ] Optional: let the mall be a **mission/taxi destination** so the Goal 3
  waypoint can point you to it (`markerPos = world.poi.terminal21`).
- **Acceptance:** the mall reads as a destination on both maps and feels like a
  themed place, not a grey box.

## Phase 5 — Verification

- [ ] New `tools/mall_test.mjs` probe (model it on `tools/physics_test.mjs` /
  `hud_test.mjs`): boot via the save-slot, teleport the player to
  `GAME.world.poi.terminal21`, press **E**, assert `GAME.interior === 'terminal21'`
  and the player Y/position is the interior spawn; walk to a shop and assert its
  overlay opens (a `.show` overlay + the right `GAME.state`); buy an item and
  assert `GAME.cash` dropped + the effect applied; press **E** at the exit and
  assert `GAME.interior === null` and the player is back at the stashed outdoor
  position. Assert no outdoor crowd spawned at the interior origin while inside.
- [ ] Extend `tools/smoke.mjs` with an **interior shot** (`smoke_mall.png`:
  teleport in, stand in the atrium, screenshot) and add it to the CI upload list
  (`.github/workflows/smoke.yml`).
- **Acceptance:** the probe + `smoke` are green; the screenshot shows the atrium
  with shop fronts and the directory.

---

## Engineering guardrails

1. **Interior = pocket geometry + a flag.** No second scene/camera. Park the
   atrium far off (high Y), teleport in/out, gate outdoor systems on
   `!G.interior`. Reuse `world.buildings` for interior collision.
2. **Reuse, don't reinvent the shop UI.** The `#store` overlay + `state` +
   `sbind` + `storeBuy` pattern already exists; extend it for mall shops rather
   than building a new system.
3. **Don't break missions/taxi.** Entering the mall mid-mission must not strand
   a marker; either pause objective checks while `G.interior`, or keep the
   outdoor marker valid for when you exit.
4. **Persist nothing fragile.** The interior is rebuilt each load; only the
   player's outdoor exit position needs stashing (in memory, not the save).
5. **Harness boots via the save-slot menu** (click the first `#slots button`).
   The probe just sets `GAME.world.poi.terminal21` proximity + presses E.
6. **No build step.** Everything stays "serve the folder and it runs."

---

## Done definition

From the Asok street you can see **Terminal 21**, walk to its entrance, press
**E**, and be standing inside a themed atrium with escalators, a directory, and
shop fronts you can browse and buy from — then walk out the same door back onto
the street where you left, traffic and crowd intact. The mall shows on the
minimap and TAB map, and a `mall_test` probe plus the `smoke` harness are green
with a screenshot of the interior.

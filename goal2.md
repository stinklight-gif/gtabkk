# Goal 2: Make daytime look like daytime (+ harness, CI, repo refresh)

The previous plan (`goal.md`) is **done** — phases 1–4 and most of 5 shipped
across ~96 commits: street canyons, power lines, awnings, rooftop tanks/setbacks,
the distant skyline ring, Yaowarat, the temple, the river. The geometry now
reads as a city. This file is the successor plan, written after a verified
runtime audit (headless Chromium, screenshots at multiple times of day).

**The headline finding: noon renders almost identically to 9 PM.** At 12:00 the
sky is blue but every facade is a pitch-black silhouette and the window texture
reads as "lit windows at night." The night render is genuinely good — the
problem is purely the daylight model, and it's a tuning pass, not a rewrite.
Secondary findings: the repo's own face is stale (`screen.png` is 96 commits
old, `goal.md` checkboxes all unticked despite being done), three.js is a
runtime CDN dependency that fails in sandboxed/offline environments, and there
is no automated way to prove the game still boots.

Phases are ordered by ROI. Phase 0 first — it's what lets every later phase
prove itself with screenshots instead of vibes.

All line numbers below were verified against the current `main.js` (4818 lines)
and `index.html`. Re-grep before editing; they will drift.

---

## Phase 0 — Verification harness (do this first)

Right now there is no way to see the game without a human, a GPU, and internet
access to jsdelivr. Fix all three, then wire CI.

### 0.1 Vendor three.js

- [ ] `npm pack three@0.160.0` (or copy from `node_modules`) and check in:
  - `vendor/three.module.js` (from `build/`)
  - `vendor/jsm/` (from `examples/jsm/` — at minimum `utils/BufferGeometryUtils.js`,
    which Phase 3 needs; the whole folder is fine too)
- [ ] Update the importmap at `index.html:200-205`:
  ```html
  "three": "./vendor/three.module.js",
  "three/addons/": "./vendor/jsm/"
  ```
- [ ] Delete (or no-op) the CDN watchdog at `index.html:318-327` — its entire
  failure mode ("Could not load three.js — needs internet") no longer exists.
- [ ] README "Run it" section: remove the "needs internet on first load" caveat.

This keeps the no-build philosophy intact — it's still a plain ES-module page,
just self-contained. It also makes the game work offline and inside sandboxed
CI/agent containers where jsdelivr is blocked (this was hit during the audit:
the network policy 403'd `cdn.jsdelivr.net`; npm's registry was reachable).

### 0.2 Headless smoke test — `tools/smoke.mjs`

A Playwright script that boots the real game and produces screenshot evidence.
The recipe below is **known-working** (it produced the audit screenshots);
every detail was learned the hard way, don't rediscover them:

- Launch flags: `chromium.launch({ args: ['--no-sandbox',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })` — without the
  ANGLE/SwiftShader flags, WebGL context creation fails silently in headless
  containers and the loader never finishes.
- Serve the repo root with any static server (`npx http-server -p 8765 -s`),
  poll the port with `curl` until it answers — don't `sleep`.
- The start button is **`#startbtn`** (`index.html:218`), no `disabled`
  attribute toggle — just `waitForSelector('#startbtn')` then click. Give it a
  generous timeout (120s+): under SwiftShader, world build is CPU-rendered and
  slow.
- Pointer lock **works** in headless Chromium; the game enters `state:
  'playing'` normally. If it ever drops, the game flips to `'paused'`
  (`main.js:319-323`) — force-resume from the test with
  `GAME.state = 'playing'`.
- The sim runs slow under SwiftShader because of the frame-time clamp
  (`const dt = Math.min(0.05, G.clock.getDelta())`, `main.js:4691`): at ~4 fps
  the sim advances at ~1/5 wall-clock speed. Never assert wall-clock timing;
  drive state directly via the `window.GAME` debug API instead:
  ```js
  GAME.time.dayT = 0.5;                       // noon (0=midnight, 0.5=noon)
  GAME.time.dayT = 0.87;                      // ~20:50, full neon
  GAME._rainTarget = 0; GAME.time.rainStrength = 0;  // force clear weather
  GAME.player.group.position.set(0, 0, -130); // teleport
  GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = -0.02;  // aim camera
  ```
- Give `page.screenshot()` an explicit long timeout (`{ timeout: 120000 }`) —
  the default 30s can expire while SwiftShader chews on a heavy frame.
- Collect `pageerror` and console `error` events; **the test fails if any
  fire**. (Baseline worth protecting: the current build boots with zero.)

- [ ] Script: boot → click `#startbtn` → wait for `window.GAME` → assert no
  page errors → capture `smoke_noon.png` (dayT 0.5, clear) and
  `smoke_night.png` (dayT 0.87) at a street-level mid-map position → assert
  both files are non-trivial (> 20 KB) → exit non-zero on any error.
- [ ] Log `GAME.renderer.info.render.calls` in the output (Phase 3 baseline).
- [ ] Document one-liner in README:
  `npx http-server -p 8765 & node tools/smoke.mjs`

### 0.3 CI

- [ ] GitHub Action (`.github/workflows/smoke.yml`): checkout → setup-node →
  `npx playwright install chromium` → serve → run `tools/smoke.mjs` → upload
  the two screenshots as artifacts. Trigger on PR + push to main.

**Acceptance:** a PR shows a green check plus downloadable noon/night
screenshots; deleting `window.GAME` or throwing in `init()` turns it red.

---

## Phase 1 — Daylight lighting overhaul (the big one)

Diagnosis from the audit, four compounding causes. The fixes are all value
tuning in two places. **Critical gotcha:** `updateDayNight()`
(`main.js:4417-4454`) overwrites `sun.intensity`, `hemi.intensity`,
`amb.intensity`, sky color, and fog **every frame** — tuning the values in
`init()` (`main.js:2292-2312`) alone does nothing while playing. Tune the
per-frame formulas.

### 1.1 Tilt the sun

At noon the sun sits at `(0, 90, 30)` — ~72° elevation (`main.js:4421-4425`:
`sx = cos(sunAngle)*100, sy = sin(sunAngle)*90, sz = 30`). Vertical walls get
`N·L ≈ 0` from a near-zenith sun, so facades go black exactly when the day is
brightest.

- [ ] Raise the lateral offset so noon elevation lands at ~40-50°: `sz = 30` →
  `~110` (elevation `atan(90/110) ≈ 39°`), or scale `sy` down. Keep the
  east-to-west arc so mornings/evenings still rake along the EW streets.
- [ ] Sanity-check dawn/dusk after: `dayK = clamp(sin(sunAngle) + 0.2, 0, 1)`
  (`main.js:4427`) stays as-is unless sunrise looks off.

### 1.2 Brighten the fill

Vertical surfaces live off hemi + ambient, and both are currently dark and
cold:

- [ ] Hemisphere (`main.js:2305`): ground color `0x33271a` → a warm concrete
  bounce (`~0x8a7f72`); sky color can stay. Day intensity formula
  (`main.js:4429`): `0.25 + dayK * 0.5` (max 0.75) → `~0.3 + dayK * 0.8`
  (max ~1.1).
- [ ] Ambient (`main.js:2310`): color `0x223040` → something neutral-warmer
  (`~0x404856`); formula (`main.js:4430`): `0.10 + dayK * 0.10` →
  `~0.10 + dayK * 0.18`.
- [ ] Optional: ramp `renderer.toneMappingExposure` 1.0 → ~1.15 with `dayK`
  (exposure is set once at `main.js:2287`; add it to `updateDayNight`).

### 1.3 Lighten the albedos

Bangkok surfaces are sun-bleached, not charcoal. Current values render black
under any plausible light level:

- [ ] `COLORS.asphalt` `0x1a1c20` → `~0x34373c` (`main.js:22`, used by
  `groundMat` at `main.js:400`).
- [ ] `roadMat` `0x111418` → `~0x3a3d42` (`main.js:406`).
- [ ] `COLORS.building` palette (`main.js:25`): lighten ~40% across the board,
  e.g. `[0x4a4a55, 0x5a5560, 0x6a5a45, 0x504848, 0x3f4045]` →
  `[0x7a7a88, 0x8d8794, 0x9a8a70, 0x837a7a, 0x6e7077]`. Keep variety, keep
  them dustier than the shop band (`SHOP_COLORS`, `main.js:466`, is already
  good).
- [ ] **Protect the night look while doing this.** Night reads great today and
  it's driven by emissives (`G.nightEmissive` / `G.nightLights` ramps at
  `main.js:4447-4454`), not albedo — so lightening albedo should mostly affect
  day. Verify with before/after night screenshots from the Phase 0 harness; if
  night gets too milky, drop the night-time fog color/density slightly or pull
  `amb` night floor down.

### 1.4 Fix the shadow camera

The sun's shadow camera is a fixed ±80 m box (`main.js:2296-2299`) anchored
where the light points — effectively the world origin, since `sun.target` is
never moved and `sun.position` orbits near `(0,90,30)`. The map is ±250 m, so
~90% of the playable area gets out-of-frustum shadow sampling (black or streaky
bands at the edges).

- [ ] In `updateDayNight`, re-anchor per frame:
  ```js
  const p = G.player.group.position;
  G.sun.target.position.copy(p);
  G.sun.position.set(p.x + sx, sy, p.z + sz);   // sx/sy/sz from the orbit math
  G.sun.target.updateMatrixWorld();
  ```
  (`scene.add(sun.target)` once in `init()`.) Keep the ±80 box and the
  existing `bias = -0.0008`.
- [ ] If shadow edges shimmer while moving ("swimming"), snap the shadow camera
  position to shadow-map texel increments — standard fix, ~5 lines; only bother
  if it's visible.

### 1.5 Re-check the "lit windows at noon" artifact

`winMat` already has `dayIntensity: 0` (`main.js:473-476`) — the windows are
*not* emissive at noon. They look lit because the window texture's bright cells
sit on a facade that renders black. Expect this to vanish once 1.1–1.3 land.

- [ ] Verify on the noon screenshot; if towers still look night-lit at midday,
  darken the lit-cell color in `makeWindowTexture()` (`main.js:1607`) for the
  albedo `map` only (keep `emissiveMap` bright for night).

**Acceptance:** harness noon screenshot is unmistakably daytime — sunlit facade
faces, visible shadows with direction, mid-grey (not black) roads — and clearly
distinct from the night screenshot. Facades are never pure black at any
daytime hour anywhere on the map (spot-check a map corner, e.g.
`(±200, ±200)`). Night still looks as good as it does today. The old
`goal.md` "5 seconds → that's a city" test now passes at **any** time of day.

---

## Phase 2 — Repo face-lift (30 minutes, do right after Phase 1)

- [ ] Regenerate `screen.png` from the Phase 1 noon or night build (the
  current one is 96 commits old — the "boxes in a field" era — and badly
  undersells the project).
- [ ] Mark `goal.md` phases 1–4 (+ the done parts of 5) as complete, with a
  pointer to this file as the successor — or fold its leftovers in here and
  delete it. Stale unchecked boxes actively mislead future sessions.
- [ ] README pass: drop the internet-on-first-load caveat (Phase 0), re-verify
  the "Limits / Known compromises" list (some entries may be fixed by now),
  and add the smoke-test one-liner.

---

## Phase 3 — Draw-call diet (only if perf is actually short)

Rooftop decor, lamps, poles, wires, and lanterns are already instanced.
Buildings are not: `placeBuilding()` (`main.js:502`) creates 4–6 individual
meshes each (upper box, shop box, window planes, neon sign, awning) × ~300+
buildings ≈ **~1,500 draw calls** for the static city.

- [ ] Measure first via the harness: `GAME.renderer.info.render.calls` at a
  street-level view. If it's comfortably 60 fps on the target hardware
  (integrated GPUs), **skip this phase**.
- [ ] The materials are already pooled (`buildingMatPool` `main.js:460`,
  `shopMatPool` `main.js:467`, shared `winMat` `main.js:473`) — so group the
  static `BoxGeometry`s by material, bake world transforms into the
  geometries, and `BufferGeometryUtils.mergeGeometries()` them into one mesh
  per material (~15 meshes total). Same for window planes (one mesh — shared
  `winMat`) and neon signs (one per neon color; their per-material
  `nightEmissive` ramps keep working unchanged).
- [ ] Collision is untouched: `world.buildings` stores `pos`/`size` AABBs and
  the resolvers (`main.js:2917`, `main.js:2939`) never touch the mesh. Check
  the few places that use the stored `mesh` ref before deleting it.
- [ ] Frustum-culling tradeoff (merged = one bounding box) is fine on a 500 m
  map — most of it is in view anyway.
- [ ] Re-run the smoke test; assert calls dropped (expect < 300) and compare
  screenshots for regressions.

---

## Phase 4 — Gameplay polish (small, independent items)

- [ ] **Road-aware cop steering.** `updateCop()` (`main.js:4147-4161`) lerps
  heading straight at the player, so 2★+ chase cars grind along building walls
  in the canyons. Cheap fix that fits the arcade feel: when the player is
  > ~25 m away, steer toward the nearest road centerline first (roads are a
  50 m grid, `ROAD_W = 12` — `main.js:410` — so the nearest centerline is
  `Math.round(v / 50) * 50` on each axis), then along the grid toward the
  player's block; switch to direct pursuit inside 25 m so ramming still works.
  Keep `resolveVehicleVsBuildings` as the backstop.
- [ ] **Slower clock.** `DAY_LENGTH = 240` (`main.js:4415`) means a mission can
  span dusk-to-dark mid-chase. Once daylight is worth looking at (Phase 1),
  bump to ~480 s. Check nothing else assumes 240 (grep `DAY_LENGTH`; the dawn
  temple bell at 5–6 AM and night cop bonus key off `dayT`/`nightK` and are
  fine).
- [ ] Leave traffic not yielding at intersections — documented in the README as
  authentic Bangkok, and it is.

---

## Phase 5 — Structural (optional, only if development continues)

- [ ] **ES-module split, no build step.** `main.js` is 4,818 lines and still
  navigable thanks to the numbered sections, but it's at the edge. If it keeps
  growing, split along the existing section boundaries into native modules
  (`audio.js`, `world/`, `vehicles.js`, `npcs.js`, `combat.js`, `wanted.js`,
  `missions.js`, `hud.js`, `loop.js`) loaded via the importmap — no bundler.
  Keep `window.GAME` stable; the harness and the README dev snippets depend
  on it.
- [ ] **Save schema.** If Phase 4 balance changes meaningfully alter
  progression, bump `gtabkk_save_v1` → `_v2` with a migration (or just accept
  the wipe and bump the key).

---

## Engineering guardrails (read before touching anything)

1. **`updateDayNight` owns the lights.** It overwrites sun/hemi/ambient
   intensity, sky, and fog every frame (`main.js:4417-4441`). All lighting
   tuning goes in its formulas; `init()` values only matter for the first
   frame.
2. **Always screenshot noon AND night** (via the Phase 0 harness) before and
   after any lighting/material change. The night look is an asset — don't
   trade it for daylight.
3. **Don't re-tune fog while the scene is dark.** Brighten first (Phase 1),
   then revisit fog only if the skyline ring reads wrong. (Same advice the old
   goal.md gave, still right.)
4. **The dt clamp** (`main.js:4691`) makes sim speed proportional to frame
   rate below 20 fps. Fine for gameplay; just never write tests that assume
   wall-clock sim timing.
5. **Sandboxed environments:** jsdelivr may be blocked (403 host_not_allowed);
   npm registry is reachable. After Phase 0 this stops mattering.
6. **No build step is a feature.** Every phase above preserves
   "serve the folder and it runs."

---

## Done definition

CI is green with noon/night screenshot artifacts on every PR. The noon
artifact is unambiguous daytime; the night artifact is at least as good as
today's. `screen.png` shows the current build. `renderer.info.render.calls`
is measured (and < 300 if Phase 3 ran). A stranger shown the noon screenshot
says "midday in Bangkok" — and a stranger shown the repo says the screenshots
match the game.

# Goal: Make gtabkk actually look like a city (Sukhumvit, Bangkok)

The current render is "colored boxes scattered in a field." This file is the plan to turn it into a recognizable Bangkok street. Phases are ordered by visual ROI — finishing Phase 1 + 2 alone should already make it unmistakably a city; later phases are diminishing-returns polish.

All work lives in `main.js` (single-file three.js project, no build step). The world is built in `buildWorld()` starting at `main.js:265`. Map is 500m × 500m, 10×10 block grid, 50m blocks.

---

## Phase 1 — Street canyon (foundation)

Without this, none of the other work pays off — the basic compositional problem is "boxes in a field," not "boxes lack detail." Buildings need to flank the road and form a continuous wall.

- [ ] **Re-place buildings along the sidewalk edge**, not random inside the block. Buildings front the road; backs touch other buildings' backs. Replace the random-in-block placement at `main.js:374-432`.
- [ ] **Variable-width buildings on a 1D frontage**: for each of the 4 sides of each block, pick a random width 8–25m, march along the sidewalk until full. Gaps become alleys (sois), not voids.
- [ ] **Two-tone facades**: bottom 4m in a "shop level" color (cream / dirty white / red), upper floors in the existing palette. Single biggest "looks like real buildings" trick for almost no work. Implement as a second `BoxGeometry` on the lower 4m or as a vertex-colored material.
- [ ] **Update `world.buildings` collision array** to match the new placement scheme so `resolvePlayerVsBuildings` (main.js:1265) still works.

**Acceptance:** Standing on any road, you see a continuous wall of buildings on both sides — no more empty gaps to the horizon.

---

## Phase 2 — Bangkok street clutter (the "people live here" layer)

Fills the empty foreground. The view from the camera should be busy with stuff *between* you and the buildings.

- [ ] **Tangled overhead power lines** — the single most "Bangkok" visual cue.
  - Utility poles every 25–35m along each road (wood/concrete cylinder, ~6m tall).
  - 3–6 wires per span between poles, instanced `LineSegments` with slight catenary sag.
  - Bonus: a couple of "wire bundle" knots near intersections.
- [ ] **Perpendicular hanging signs** sticking out from shop fronts — small colored quads on a thin arm. Breaks up flat facades from any angle.
- [ ] **Awnings**: thin slabs (tarp blues/reds/greens) over the sidewalk in front of shop-level buildings. ~2m extension, 3m above ground.
- [ ] **Parked motorbike clusters** along curbs — reuse the existing bike geometry from `makeVehicleMesh('bike')` (main.js:687), `InstancedMesh` for performance.
- [ ] **Sidewalk props**: food carts (box + umbrella), plant pots, trash bags. Scattered, not dense — ~1 per 15m of sidewalk.

**Acceptance:** From any first-person view, the screen has visible stuff within 10m of the camera. The sidewalks no longer look swept clean.

---

## Phase 3 — Building silhouette break-up

Turns cubes into buildings at distance. Current buildings are featureless boxes, which is why even tall ones don't read as towers.

- [ ] **Rooftop water tanks** (cylinder on a small leg frame) — iconic Bangkok skyline element. One per ~60% of buildings, especially mid-rises.
- [ ] **Rooftop AC condensers + antennas** — small clustered cubes/cylinders, instanced.
- [ ] **Setbacks**: 30% of tall buildings get a narrower upper section (a second smaller `BoxGeometry` stacked on top).
- [ ] **Balconies on mid-rises**: thin slab projections at each floor level for residential-looking blocks. Skip if too expensive; setbacks alone help a lot.

**Acceptance:** Looking at the skyline, no two buildings have the same silhouette. Rooftops are jagged, not flat.

---

## Phase 4 — Skyline depth

Fakes a bigger world beyond the 500m boundary so the eye has somewhere to go.

- [ ] **Distant city ring**: low-detail building silhouettes outside the playable bounds. `InstancedMesh` with ~200 boxes in a band from 250m–500m out, no windows, no detail, fading into haze.
- [ ] **Re-tune fog** (`main.js:969`, `main.js:2194`) with the ring in place. Fog can now stay moderately dense since it's fogging into a layered skyline rather than empty sky. Target density: ~0.0015 day, ~0.004 night.
- [ ] **Optional**: a couple of named landmark towers (Baiyoke II silhouette) much taller than the rest, visible from anywhere.

**Acceptance:** Looking out from the map edge, there's a visible skyline behind the playable area, not just sky.

---

## Phase 5 — Bangkok-specific polish

Once the city feels like a city, this is what makes it feel like *Bangkok*.

- [ ] **Sois (alleys)** branching off main roads at random intervals — narrower, no center stripe, denser low-rise buildings.
- [ ] **Khlong (canal)** along one map edge with a small footbridge. Color already in palette (`COLORS.khlong`).
- [ ] **Temple** (wat) in one block with a golden curved roof and a chedi (white spire).
- [ ] **Painted wall signage** — colored stripes/blocks on side walls to suggest Thai script billboards.
- [ ] **Sky-train station** at one of the BTS pillars (main.js:434), not just the bare beam.

**Acceptance:** A stranger looking at a screenshot guesses "Bangkok" or "Southeast Asia," not "generic city."

---

## Engineering notes

- **Move to `InstancedMesh` for repeated props**: poles, wires, signs, motorbikes, AC boxes, water tanks. Per-Mesh creation will get expensive once Phases 2–3 land. Current code at `main.js:294-302` already collects `buildingGeoms`/`neonGeoms` but never instances them — wire up instancing properly while we're in there.
- **Keep `world.buildings` collision data in sync** with the new placement scheme so `resolvePlayerVsBuildings` (main.js:1265) and `resolveVehicleVsBuildings` (main.js:1287) still work.
- **Performance budget**: target staying above 60fps on M-series Macs. The current scene has ~300 buildings; we'll be adding maybe 10× that in instanced props.
- **Don't touch fog density until after Phase 4** — fog is currently hiding all the bad and tuning it now would mask whether new geometry is helping.

---

## Done definition

The user opens the game, spawns at the station, and within 5 seconds of looking around says "okay, that's a city." Bonus: "that's Bangkok."

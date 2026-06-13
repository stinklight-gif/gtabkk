# Goal: Make gtabkk actually look like a city (Sukhumvit, Bangkok)

> **STATUS: COMPLETE.** This plan shipped across ~96 commits — street canyons,
> power lines, awnings, rooftop clutter, the skyline ring, Yaowarat, the
> temple, the river. The successor plan is **`goal2.md`** (daylight lighting,
> verification harness, CI, draw-call diet). Boxes below are ticked to match
> what actually landed; deviations are annotated inline.

The current render is "colored boxes scattered in a field." This file is the plan to turn it into a recognizable Bangkok street. Phases are ordered by visual ROI — finishing Phase 1 + 2 alone should already make it unmistakably a city; later phases are diminishing-returns polish.

All work lives in `main.js` (single-file three.js project, no build step). The world is built in `buildWorld()`. Map is 500m × 500m, 10×10 block grid, 50m blocks.

---

## Phase 1 — Street canyon (foundation)

Without this, none of the other work pays off — the basic compositional problem is "boxes in a field," not "boxes lack detail." Buildings need to flank the road and form a continuous wall.

- [x] **Re-place buildings along the sidewalk edge**, not random inside the block. Buildings front the road; backs touch other buildings' backs.
- [x] **Variable-width buildings on a 1D frontage**: for each of the 4 sides of each block, pick a random width 8–25m, march along the sidewalk until full. Gaps become alleys (sois), not voids.
- [x] **Two-tone facades**: bottom 4m in a "shop level" color (cream / dirty white / red), upper floors in the existing palette. *(Shipped as the `SHOP_COLORS` band + separate shop box per building.)*
- [x] **Update `world.buildings` collision array** to match the new placement scheme so `resolvePlayerVsBuildings` still works.

**Acceptance: met.** Standing on any road, you see a continuous wall of buildings on both sides.

---

## Phase 2 — Bangkok street clutter (the "people live here" layer)

Fills the empty foreground. The view from the camera should be busy with stuff *between* you and the buildings.

- [x] **Tangled overhead power lines** — utility poles along each road, sagging wire spans, bundle knots near intersections.
- [x] **Perpendicular hanging signs** sticking out from shop fronts.
- [x] **Awnings**: thin slabs (tarp blues/reds/greens) over the sidewalk in front of shop-level buildings.
- [x] **Parked motorbike clusters** along curbs (instanced).
- [x] **Sidewalk props**: food carts (box + umbrella), plant pots, trash piles.

**Acceptance: met.** From any first-person view, the screen has visible stuff within 10m of the camera.

---

## Phase 3 — Building silhouette break-up

Turns cubes into buildings at distance.

- [x] **Rooftop water tanks** (cylinder on a small leg frame), instanced.
- [x] **Rooftop AC condensers + antennas**, instanced.
- [x] **Setbacks**: tall buildings get a narrower upper section with its own window strip.
- [ ] ~~**Balconies on mid-rises**~~ — skipped, per this item's own "skip if too expensive" caveat; setbacks + rooftop clutter carried the silhouette.

**Acceptance: met.** Rooftops are jagged, not flat.

---

## Phase 4 — Skyline depth

Fakes a bigger world beyond the 500m boundary.

- [x] **Distant city ring**: ~380 low-detail silhouettes in a 250–500m band, instanced per color, no shadows.
- [x] **Re-tune fog** with the ring in place. *(Re-tuned again in goal2.md Phase 1 alongside the daylight overhaul.)*
- [x] **Landmark towers** — four 180–260m towers with pointed caps, visible from anywhere.

**Acceptance: met.** Looking out from the map edge, there's a skyline behind the playable area.

---

## Phase 5 — Bangkok-specific polish

- [ ] ~~**Sois (alleys)** branching off main roads~~ — not built; block-interior courtyard gaps partially serve the role. Revisit only if a denser-street pass ever happens.
- [x] **Khlong (canal)** — *upgraded in scope*: shipped as the full **Chao Phraya river** along the west edge (water, embankment, pier, longtail boats — one drivable) instead of a canal.
- [x] **Temple** (wat) — landmark block with viharn, golden roof, white chedi with gold spire, dawn bell.
- [ ] ~~**Painted wall signage**~~ — not built; neon signs + hanging shop signs ended up carrying the signage role.
- [x] **Sky-train station** — elevated platform + canopy + stair tower on the BTS track, with a sliding train.

**Acceptance: met** (via Yaowarat's paifang gate + lanterns + market stalls, the wat, the river): screenshots read "Southeast Asia," not "generic city."

---

## Done definition

The user opens the game, spawns at the station, and within 5 seconds of looking around says "okay, that's a city." Bonus: "that's Bangkok."

**Met at night from the start; met at noon as of goal2.md Phase 1** (the daylight
overhaul — before that, midday rendered nearly as dark as 9 PM).

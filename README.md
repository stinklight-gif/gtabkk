# Bangkok 3D — Phase 1 Prototype

A single-file browser-playable 3D open-world prototype set in Bangkok, in the
spirit of GTA III but with its own identity. Implements the Phase 1 deliverables
from `gta.md`: Sukhumvit district, multiple vehicles, on-foot Muay Thai melee, 9mm
pistol, day/night cycle, monsoon rain with wet streets, traffic + peds + soi dogs, functional
minimap, 1–3 star wanted system with bribe mechanic, tutorial mission, and
free-roam.

## Run it

It's a plain ES-module page — no build step. Just serve the folder:

```bash
python3 -m http.server 8765
# then open http://127.0.0.1:8765/
```

Three.js is vendored in `vendor/` (resolved via importmap), so it works fully
offline. When the loader finishes, pick a save slot to start.

## Smoke test

A headless Playwright harness boots the real game, fails on any page error, and
captures a screenshot suite (`smoke_noon.png`, `smoke_night.png`, `smoke_3am.png`,
festival, waypoint, map, mall, BTS, chase, river, and bank shots) along with the
renderer draw-call count:

```bash
npm install --no-save playwright && npx playwright install chromium   # once
node tools/smoke.mjs
```

CI (`.github/workflows/smoke.yml`) runs it on every PR and push to main, and
uploads the screenshots as artifacts. In sandboxes where Playwright's browser
CDN is blocked, point `CHROME_PATH` at any Chrome/Chromium binary.

`node tools/realism_pass_test.mjs` runs alongside it in CI and covers the
performance budget, the Moto Drop loop, driving/collision/camera feel, and —
sections `[5]`/`[6]` — the engine speed curve, the friction circle, police line
of sight, wanted-heat accumulation, fall damage, and frame-rate independence.
`physics_test`, `hud_test`, `traffic_test` and `mall_test` are local-only.

## Controls

| Key | Action |
|---|---|
| WASD | Move / drive |
| Mouse | Look / aim |
| Shift | Sprint (foot) / boost (vehicle) |
| Space | Jump (foot) / handbrake (vehicle) |
| E | Enter/exit vehicle |
| F | Melee attack / fire active weapon |
| LMB | Fire active weapon (also drive-by while driving) |
| RMB | Aim (pistol) — shows crosshair |
| Q | Cycle weapon (fists / pistol / SMG / shotgun, whichever are owned) |
| R | Reload (optional; ammo is unlimited) |
| Ctrl | Block |
| B | Bribe a nearby cop (฿1,000) at 1–2★ |
| H | Honk (in vehicle) |
| M | Car radio — cycle stations (Luk Thung / Bangkok Bars / Talk Radio / off) |
| J | Start a taxi fare (in a songthaew) |
| Y / J | Start Moto Drop (on a motorbike or tuk-tuk) |
| T | Phone — pauses pointer lock and shows menu |
| +/- / 0 | Zoom / reset the full map while TAB map is open |
| P | Photo mode — free-fly camera + hidden HUD (WASD/Space/Ctrl to fly, Shift faster) |
| V | Start Vigilante (while in a cop vehicle) |
| N | Cycle minimap zoom |
| O | Options — mouse sensitivity + master volume |
| `~` / F3 | Toggle visual/performance budget overlay |
| F8 | Open vehicle/pedestrian showcase mode (Esc to return) |
| E | Buy/rest at the safehouse · rent/retrieve at the garage (on foot) |
| K | Store the current vehicle (in a car, inside the rented garage) |
| C | Repaint the current vehicle (฿250, at the garage) |
| L | Cycle which stored vehicle to retrieve |
| G | *(dev)* grant 9mm pistol |
| Esc | Release mouse / pause (click to resume) |

## Tutorial mission

You start at Hua Lamphong with ฿100 cash. A motorbike and a tuk-tuk are parked
beside the platform. Drive (or run) to the **gold pillar of light** marker at
Uncle Seng's gold shop in the south-west corner of the map. ฿800 reward on
arrival. After that the world is open — try the bike, hit peds (gain stars),
bribe your way out, watch the monsoon roll in. Keep an eye out for **bag-snatchers**
(orange-marked peds that bolt) — run one down for a bounty.

A small gun counter sits just east of the Hua Lamphong platform. You can buy the
first pistol there, or steal it at the start for immediate heat.

**Soi Run (mission 2).** Once you've delivered the envelope, Uncle Seng has a
second job. Leave his shop and return to the **pink marker** to start *Soi Run* —
a timed checkpoint race (you'll want the bike). Reach each cyan checkpoint before
the clock runs out; every one buys you extra seconds. ฿1,500 on completion, and
it's replayable from the start line. Tune the timer/route via `startTime`,
`cpBonus`, and `route` in the `soiRun` mission object.

**The Hit (mission 3).** Winning Soi Run unlocks it. Return to the marker to
start, then drive to the marked spot (varies each run) and eliminate the four
**marked crew** (pink markers over their heads) — fists, pistol, SMG, or
shotgun. They scatter when attacked and the gunfire draws cops, so it doubles
as a wanted-level/escape loop (duck into the U-Spray after). ฿2,000, and it
unlocks Hot Delivery.

**Hot Delivery (mission 4).** The capstone. You take the job already at 3★ —
cops swarm immediately — and must drive the goods across town to the green drop
before a 60s timer runs out. Reward ฿3,000, replayable. Pure use-everything
chaos: fast wheels, the wanted system, and the garage/escape loop.

**Amulets.** 15 glowing gold amulets are hidden across the districts. Each is
฿100, and finding all of them pays a ฿2,000 bonus — an excuse to explore.

**Taxi (free-roam job).** Grab a red songthaew, press **J**, drive to the yellow
marker to pick up a fare, then to the green marker before the timer runs out.
Pay scales with distance. It's a standalone activity, separate from the story
missions, so you can run fares any time.

## Property (spend the money)

Two things to sink cash into, both persisted in your save:

- **Safehouse** (฿12,000) — a townhouse just north of the spawn (look for the red
  **FOR SALE** sign; it turns green to **HOME** once bought). Walk to the door
  and press **E** to buy. Owning it makes it your respawn point instead of the
  police station, and pressing **E** at home again heals you and saves.
- **Garage** — rent the U-Spray (฿4,000, **E** on foot inside the shed) and it
  becomes your lock-up: drive a car in and press **K** to **store** it (up to 4),
  **C** to **repaint** it (฿250, cycles colours and stamps a new Thai plate). On
  foot, **E** brings a stored car back out at the door, **L** cycles which one.
  Stored cars keep their colour, plate, and condition across reloads.

Mission rewards were bumped to feed this economy (Soi Run ฿2,500, The Hit
฿4,000, Hot Delivery ฿6,000), so the safehouse is a few jobs away.

## Architecture

The engine is split into native ES modules — no bundler, the importmap resolves
them, same "serve the folder and it runs" deal. `core.js` holds the shared
primitives (helpers, constants, the global game object `G`, pooled scratch); the
rest import from it, and `main.js` is a re-export barrel so any module can pull a
gameplay function from `./main.js` without caring which module defines it. Every
file is under ~800 lines.

- `index.html` — DOM shell, HUD overlays, importmap.
- `core.js` — helpers, constants, palettes, `G` (`window.GAME`), scratch, the
  static-geometry baker, `disposeObject`, `lerpAngle`. Pure leaf.
- `audio.js` — procedural Web Audio (engine loopers, SFX, the car radio).
- `input.js` — keyboard set + pointer-lock mouse deltas + edge-detected `pressed`.
- `world.js` — `buildWorld`: grid/roads/sidewalks/buildings, shared procedural
  asphalt/concrete/facade textures, puddle instances, instancing, the static-merge
  baker, window texture + minimap base.
- `worldLandmarks.js` — `buildLandmarks(env)`: BTS, river, garage, safehouse,
  gun shop, Yaowarat, shrines, collectibles, food/armor pickups… (the inline
  landmark blocks, fed `buildWorld`'s locals via `env`).
- `entities.js` — player/camera/vehicle/NPC mesh makers + spawns + rain.
- `player.js` — on-foot player update + interaction (enter/exit, 7-Eleven,
  safehouse, gun shop).
- `vehicles.js` — vehicle update loops, chase camera, garage store/retrieve/repaint.
- `npcs.js` — peds/dogs/crowd/clusters/muggings/spikes/vigilante.
- `combat.js` — melee + guns + bullets.
- `wanted.js` — cops + wanted system + game-over/respawn.
- `missions.js` — the stage-based mission system.
- `hud.js` — HUD bindings + full-map render.
- `physics.js` — collision resolvers + skid/dust/smoke/explosion FX.
- `daynight.js` — day/night/weather + the Loy Krathong festival.
- `main.js` — the entry: init/save, taxi, radio, photo mode, the main loop,
  boot, and the re-export barrel.

The original numbered sections (now spread across those modules):

| § | Section | Notes |
|---|---|---|
| 1 | Audio | Procedural Web Audio. Engine loopers (on a duckable `engineBus`), 7-Eleven chime, temple bell, footsteps, gunshots, sirens, rain bed, and a **car radio** — a lookahead step-sequencer (`makeRadio`) with three procedural stations (Luk Thung synth-pop, Bangkok Bars boom-bap, AM talk/ads) that play in-vehicle and duck the engine. |
| 2 | Input | Keyboard set + pointer-lock mouse deltas + `pressed` (edge) helper. |
| 3 | World | Procedural 10×10 block grid (BLOCK=50m), road grid with shared asphalt wear/crack/oil textures, concrete sidewalk slab texture, grime-mapped concrete facades, buildings with neon strips and lit-window planes, BTS Skytrain elevated track, street lamps, 7-Elevens, spirit-house shrines, gold-shop POI with pillar of light, temple compound, a U-Spray garage (drive a vehicle in to repair it and clear your wanted level for a heat-scaled fee, or rent it as a vehicle lock-up — store/retrieve/repaint), a buyable safehouse (respawn point) just north of spawn, a gun shop (buy pistol/shotgun/SMG/ammo with cash on foot), a Yaowarat Chinatown market street (paifang gate, dense shophouses, hanging lanterns, market stalls), and a Chao Phraya river down the west edge (water + embankment + pier + longtail boats, including one **drivable** longtail at the pier gap). Repeated props and puddles use `InstancedMesh`. Builds an off-screen canvas as the minimap base. |
| 4 | Player + Camera | Segmented character rig (torso/head, upper/lower arms and legs) with knees/elbows, sprint lean, and subtle sprint head-bob. Third-person camera rig has orbit yaw/pitch/distance, shake decay, occlusion, acceleration follow lag, and speed-squared FOV kick in vehicles. |
| 5b | More vehicles | City bus, luxury sedan, and a rare-spawn supercar join the traffic mix; a drivable longtail boat sits at the river pier. |
| 5 | Vehicles | `makeVehicleMesh(kind)` produces bike / tuk-tuk / hilux / cop / camry / sedan and larger/premium variants with per-kind `spec` (topSpeed, accel, brake, turn, mass, grip, wheelbase). Player vehicles keep public scalar `vel` but add lateral slip, wet-grip loss, handbrake slides/skids, speed scrub, visual pitch/roll/suspension bounce, and impulse-friendly `latVel`; boats keep their river/swell path. |
| 6 | NPCs | Articulated humanoid peds (torso/head/two-segment legs/two-segment arms) with a shared speed-blended `animateWalk` cycle, varied gait frequency/phase, knees/elbows, head look, phone walkers, rain umbrellas, walking pairs, and six archetype silhouettes (local, office worker w/ briefcase, tourist w/ cap+backpack, bald monk w/ alms bowl, conical-hatted vendor & laborer, plus a skirt variant). Crowd density follows the time of day (`crowdFactor` — dead 3am, rush-hour/midday busy) and peds spawn onto the sidewalk band (`sidewalkPos`). Behavioral clusters (`buildClusterAnchors`/`updateClusters`) queue customers at food stalls and loiterers at 7-Elevens. Traffic drivers have seeded speed/gap/amber-running/wander personalities, and motorbikes filter around blocked lanes. District banners announce Yaowarat / The Wat / Riverside / Sukhumvit on entry. |
| 7 | Rain | Particle points re-centered on the player each frame, opacity fades with weather; rain also lowers vehicle grip, darkens/glosses roads and sidewalks, raises env reflections, and fades in puddle decals that linger after storms. |
| 8 | Engine init | Renderer, lights (sun + hemi + ambient), camera, audio, world build, player, vehicles, peds, dogs. Loading bar + start gate. |
| 9 | HUD | Star/cash/HP/stamina/ammo/clock/weather binds, subtitle + prompt + notif queues, phone (T) with live stats (amulets/fares/cops + completion %), full north-up map overlay (TAB), minimap renderer (camera-yaw rotated, mission + taxi markers, amulet + snatcher + cop dots). |
| 10 | Mission system | Stage-based; the `welcome` mission listens for player proximity to the gold shop POI. Add more to the `missions` object. |
| 11 | Collisions | AABB broad collision with impulse-style response for vehicles: wall hits decompose forward/lateral speed into normal/tangent components for bounce, scrape, yaw kick, damage, dust, suspension impulse, and camera shake; vehicle-vs-vehicle collisions use mass/restitution impulses plus the legacy loose-impact channel for NPC/parked shoves. Player collision remains lightweight pushback. World-bound clamping. |
| 12 | Player update | Movement with dt-correct momentum and heavily reduced air control, sprint+stamina with an exhaustion penalty (empty the bar and you're winded for 2 s), jump, **fall damage** (free below a ~2.8 m drop, ~23 HP off the Terminal 21 upper floor, ~64 off a BTS platform; toggle with `GAMEPLAY.fallDamage`), in-vehicle controls, exit on E, segmented gait animation, 7-Eleven door chime trigger. |
| 13 | Peds + Dogs | Wander, pair-walk, crossing-wait, social, cluster, and panic state machines; peds panic when attacked or brushed by fast vehicles and turn their heads toward nearby players/traffic; dogs scatter when player approaches, settle back when far. |
| 14 | Combat | Muay Thai jab/cross/kick (animated arm/leg swings), pistol + full-auto SMG + pellet-spread shotgun fire (forgiving character hits + tracer sphere + muzzle flash + camera shake), unlimited ammo. Pistol on first cop kill; SMG drops from a destroyed 3★ Fortuner; shotgun/SMG also buyable at the gun shop. |
| 15 | Cops + Wanted | Star-based heat backed by a `G.wanted.crime` point accumulator, so a spree escalates further than a single crime, with decay after 35 s out of **line of sight** — cops need a real unobstructed line, so ducking behind a building breaks contact. Armed cops won't fire through walls and their accuracy falls off with range. Running a red light with a cop watching costs a star. Spawns foot cops at 1★, cop-pickup chase cars at 2★, unmarked Crime Suppression Fortuners + spike strips at 3★ (after ~3 cop kills), armored SWAT vans at 4★ (after ~6 kills); a star increase flashes the HUD and whoops a siren; nights run one extra unit. Bribe with B near a foot cop (1–2★ only). |
| 16 | Particles / FX | Smoke emitter (vehicles below 30% HP), explosion (light flash + smoke + camera shake + thunder SFX), tire-skid decals (`spawnSkid`, laid while drifting and faded over 5 s), impact dust puffs (`spawnDust`), and a global **hit-stop** (`triggerHitStop` slows the loop ~0.05 s on a solid melee/gun connect). |
| 17 | Interaction | Vehicle proximity check + E to enter. |
| 18 | Camera update | Follow rig with smoothed distance, shake decay, in-vehicle chase view auto-aligns to vehicle heading, **occlusion** (ray-casts target→camera against building AABBs and pulls in so it never clips into a wall), speed-squared FOV kick, acceleration follow stretch/compression, and sprint-only on-foot bob. |
| 19 | Day/Night + Weather + Festivals | 8-min day cycle drives sun position (tilted so noon actually sunlights the facades), sky/fog colours, neon and street-lamp intensity; the sun + shadow camera track the player. A whole-day counter (`G.time.day`) ticks at midnight and `scheduledFestival()` drives **Loy Krathong** nights, filling the Chao Phraya with drifting candle-lit floats + rising sky lanterns and a riverside crowd — press **E** at the bank to float your own krathong (+฿50). Monsoon weather (clear ⇄ drizzle/downpour) with lightning, wet material response, puddles, lower road grip, and dawn temple bell at 5–6 AM. |
| 20 | Main loop | Single `loop()` calls every system in order. |

The mutable global is `window.GAME`. Useful while developing:

```js
GAME.player.hp = 100;
GAME.cash = 99999;
GAME.wanted.stars = 0;
GAME.time.dayT = 0.85;          // 8:24 PM — neon comes alive
GAME.time.weather = 'rain'; GAME._rainTarget = 0.85; GAME.time.rainStrength = 0.85; // force monsoon
GAME.player.weapons.pistol = true; GAME.player.pistolAmmo = 12;
```

## Start menu, save slots & onboarding

On load you get a **start menu** with three **save slots** — each shows New game
or *Continue* with its cash and in-game day, and an ✕ to erase it. Pick a slot to
play; that slot autosaves (cash, weapons + ammo, armor, amulets, time/day,
position, and property — the safehouse, the rented garage, and every stored car
with its colour/plate/condition) to `localStorage` every ~8 s and on exit. A
legacy single-slot `gtabkk_save_v1` save migrates into Slot 1.

First-time **tips** surface each new control the moment it's relevant (driving +
the radio when you first get in a car, the garage when you're inside it, the
safehouse at its door) and never repeat — they're tracked in `gtabkk_tips`. Wipe
everything to start truly fresh:

```js
for (const k of Object.keys(localStorage)) if (k.startsWith('gtabkk_')) localStorage.removeItem(k);
```

## Extending

**Add a district.** Drop a `buildKlongToey(scene)` next to `buildWorld` and
gate it on player position (stream in when player enters its bounds). All
geometry uses the same conventions: `scene.add(mesh)`, register buildings into
`G.world.buildings` so the AABB pushback works.

**Add a mission.** Append to the `missions` object in `makeMissionSystem`:

```js
soiRun: {
  name: 'Soi Run',
  markerPos: new THREE.Vector3(80, 0, -40),
  stage: 0,
  onStart() { G.hud.setMissionText('Soi Run'); /* … */ },
  update(dt) { /* check timer, distance, etc. */ },
}
```

Call `G.mission.start('soiRun')` to switch missions.

**Add a vehicle.** Add a branch to `makeVehicleMesh(kind)` and register the
spec. Anything with a `spec` and `mesh` slots into the existing physics and
traffic AI.

## Limits / Known compromises

- All geometry is procedural — no GLTF assets. Faster to ship, less detail.
- Collisions still use simple AABB/contact normals rather than a full rigid-body
  solver. Vehicle impacts now bounce, scrape, spin, and exchange momentum, but
  they are tuned game impulses, not continuous physics.
- Vehicles have a speed-dependent engine taper, rolling + quadratic aero drag
  (so top speed is an emergent terminal velocity rather than a clamp), a friction
  circle shared between braking and cornering, and weight transfer that feeds
  back into steering. There is still no drivetrain: no gears, clutch, RPM or
  torque curve, no per-wheel tire model or slip ratio, no per-corner suspension,
  no rollover, no fuel, and damage is one `hp` number plus `tiresBlown` rather
  than per-component.
- Police line of sight is a segment test against building AABBs, cached per cop
  at 5 Hz. It does not account for vehicles, props or crowds as cover — only
  buildings block a line.
- Traffic AI is grid-aware with signal stops, obstacle yielding, seeded driver
  personalities, amber runners, and bike filtering; it is still lane-following
  rather than route-planned city driving. Signals still run on one shared
  city-wide phase (a deliberate anti-deadlock choice), and pedestrians still have
  no pathfinding — they walk through buildings.
- Cops use lightweight road-aware steering, not true pathfinding: beyond ~25 m
  they route along the 50 m road grid (so they stop grinding the canyon walls);
  inside 25 m they pursue and ram directly. AABB pushback is still the backstop.
- Audio is fully synthesised, including the car radio's three procedural music
  stations — catchy enough to read as luk-thung / hip-hop / talk, but not actual
  songs. Licensed or hand-composed tracks would be a future upgrade.

## Performance

Targets 60 FPS at 1080p on integrated GPUs. The static city is geometry-merged:
road stripes, sidewalks, building boxes, window/neon planes, awnings, signs and
sidewalk props are each baked to world space and merged into one mesh per
material at world-build time. That takes a street-level view from ~7,700 meshes
/ ~2,800 draw calls down to ~1,200 meshes / **~370 draw calls** (measured via
`tools/smoke.mjs`, which prints `renderer.info.render.calls`). What's left is
mostly dynamic — vehicles, peds, dogs, the puddle/rooftop/lamp/wire `InstancedMesh`
batches — plus a few one-off landmarks. A busy midday crowd (the articulated
peds are higher-detail near the camera and switch to boxy far LODs) adds a few
hundred calls when the sidewalks are full, landing inside the live visual budget;
the small hours drop back toward the static floor. If it still chugs, lower `PED_TARGET`, raise the
pedestrian/traffic despawn radius, or drop pixel ratio.

The in-game visual budget overlay (`~` / F3) now turns the live scene metrics
into pass/warn/fail checks. Current targets are 55+ FPS, <=900 draw calls,
<=450k triangles, <=850 visible meshes, <=180 active entities, <=95 high-detail
near LOD entities, and at least 8 far low-detail LOD entities. The CI realism
probe exercises the same thresholds through `tools/realism_pass_test.mjs`.

Repeated props (rooftop tanks/AC/antennas, lamps, poles, wires, Yaowarat
lanterns, parked bikes, puddles) use `InstancedMesh`; pooled materials with
night-emissive and wet-weather ramps are shared, so the per-frame day/night loop
touches cached material arrays, not the scene graph.

## Balance knobs (first-pass — tune after a playtest)

These values were set without runtime testing; adjust to taste. Locations are in
`main.js`:

| Knob | Where | Value |
|------|-------|-------|
| Soi Run timer / per-checkpoint bonus | `soiRun.startTime` / `.cpBonus` | 55s / +15s |
| Soi Run reward | `soiRun.reward` | ฿2,500 |
| The Hit reward | `hit.reward` | ฿4,000 |
| Hot Delivery timer / reward | `delivery.startTime` / `.reward` | 75s / ฿6,000 |
| Safehouse / garage rent / repaint | `PRICE` | ฿12,000 / ฿4,000 / ฿250 |
| Garage capacity | `econ.garage.capacity` | 4 cars |
| Taxi fare | `updateTaxi` | ฿120 + ฿5/m, 25s + dist |
| Vigilante bust / time bonus | `updateVigilante` | ฿200 + ฿100×busts / +15s |
| Snatcher bounty | `updateMuggings` | ฿400 |
| Amulet / full set bonus | `updateCollectibles` | ฿100 / +฿3,000 |
| Street-food heal | `updateFoodStalls` | +25 HP |
| Garage respray fee | `updateGarage` | ฿300 + ฿350×stars |
| Cops desired (1/2/3★) | `updateWanted` | 2 / 4 / 6 (+1 at night) |
| 3★ escalation threshold | `onCopKilled` | 3 cop kills |
| Spike-strip cadence | `updateSpikes` | every 12s at 3★ |
| Out-of-combat HP regen | `loop` | 5/s after 5s |
| Fall damage threshold / rate | `updatePlayer` | >10 m/s impact, 6.5 HP per m/s over, capped 95 |
| Cop LOS refresh / sight radius | `wanted.js` | 5 Hz / 30 m |
| Cop hit chance (point blank → 22 m) | `updateFootCops` | 0.72 → 0.14, damage 10 → 4 |
| Crime points per star | `CRIME_THRESHOLDS` | 1 / 5 / 12 / 22 / 38 |
| Crime points (civ shot / killed, hit-and-run, cop killed) | `raiseWanted` calls | 2 / 5 / 5 / 9 |
| Friction-circle bite (0 = off, 1 = full) | `updatePlayerInVehicle` | 0.18 lateral floor |

## Roadmap (Phase 2+)

See `gta.md` for the full vision. Next likely additions: Yaowarat (no-cars
zone), more missions, expanded vehicle roster.

**Build the prototype. Ship it. Iterate.**

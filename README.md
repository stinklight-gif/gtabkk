# Bangkok 3D — Phase 1 Prototype

A single-file browser-playable 3D open-world prototype set in Bangkok, in the
spirit of GTA III but with its own identity. Implements the Phase 1 deliverables
from `gta.md`: Sukhumvit district, three vehicles, on-foot Muay Thai melee, 9mm
pistol, day/night cycle, light rain, traffic + peds + soi dogs, functional
minimap, 1–3 star wanted system with bribe mechanic, tutorial mission, and
free-roam.

## Run it

It's a plain ES-module page — no build step. Just serve the folder:

```bash
python3 -m http.server 8765
# then open http://127.0.0.1:8765/
```

Three.js is vendored in `vendor/` (resolved via importmap), so it works fully
offline. Click **ENTER THE CITY** when the loader finishes.

## Smoke test

A headless Playwright harness boots the real game, fails on any page error, and
captures noon/night/3am screenshots (`smoke_noon.png` / `smoke_night.png` /
`smoke_3am.png` — the last two from the same spot prove the crowd thins from a
busy midday to dead small-hours) plus the renderer draw-call count:

```bash
npm install --no-save playwright && npx playwright install chromium   # once
node tools/smoke.mjs
```

CI (`.github/workflows/smoke.yml`) runs it on every PR and push to main, and
uploads the screenshots as artifacts. In sandboxes where Playwright's browser
CDN is blocked, point `CHROME_PATH` at any Chrome/Chromium binary.

## Controls

| Key | Action |
|---|---|
| WASD | Move / drive |
| Mouse | Look / aim |
| Shift | Sprint (foot) / boost (vehicle) |
| Space | Jump (foot) / handbrake (vehicle) |
| E | Enter/exit vehicle |
| F | Melee attack (jab/cross/kick randomised) |
| LMB | Fire pistol / SMG (also drive-by while driving) |
| RMB | Aim (pistol) — shows crosshair |
| Q | Cycle weapon (fists / pistol / SMG, whichever are owned) |
| R | Reload |
| Ctrl | Block |
| B | Bribe a nearby cop (฿1,000) at 1–2★ |
| H | Honk (in vehicle) |
| M | Car radio — cycle stations (Luk Thung / Bangkok Bars / Talk Radio / off) |
| J | Start a taxi fare (in a songthaew) |
| T | Phone — pauses pointer lock and shows menu |
| P | Photo mode — free-fly camera + hidden HUD (WASD/Space/Ctrl to fly, Shift faster) |
| V | Start Vigilante (while in a cop vehicle) |
| N | Cycle minimap zoom |
| O | Options — mouse sensitivity + master volume |
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

Everything lives in two files:

- `index.html` — DOM shell, HUD overlays, importmap. No game logic.
- `main.js` — the entire engine. Organised into numbered sections:

| § | Section | Notes |
|---|---|---|
| 1 | Audio | Procedural Web Audio. Engine loopers (on a duckable `engineBus`), 7-Eleven chime, temple bell, footsteps, gunshots, sirens, rain bed, and a **car radio** — a lookahead step-sequencer (`makeRadio`) with three procedural stations (Luk Thung synth-pop, Bangkok Bars boom-bap, AM talk/ads) that play in-vehicle and duck the engine. |
| 2 | Input | Keyboard set + pointer-lock mouse deltas + `pressed` (edge) helper. |
| 3 | World | Procedural 10×10 block grid (BLOCK=50m), road grid, buildings with neon strips and lit-window planes, BTS Skytrain elevated track, street lamps, 7-Elevens, spirit-house shrines, gold-shop POI with pillar of light, temple compound, a U-Spray garage (drive a vehicle in to repair it and clear your wanted level for a heat-scaled fee, or rent it as a vehicle lock-up — store/retrieve/repaint), a buyable safehouse (respawn point) just north of spawn, a gun shop (buy pistol/shotgun/SMG/ammo with cash on foot), a Yaowarat Chinatown market street (paifang gate, dense shophouses, hanging lanterns, market stalls), and a Chao Phraya river down the west edge (water + embankment + pier + longtail boats, including one **drivable** longtail at the pier gap). Repeated props use `InstancedMesh`. Builds an off-screen canvas as the minimap base. |
| 4 | Player + Camera | Capsule character (torso/legs/head/arms), arcade third-person camera rig (orbit yaw/pitch/distance, shake decay). |
| 5b | More vehicles | City bus, luxury sedan, and a rare-spawn supercar join the traffic mix; a drivable longtail boat sits at the river pier. |
| 5 | Vehicles | `makeVehicleMesh(kind)` produces bike / tuk-tuk / hilux / cop / camry / sedan with per-kind `spec` (topSpeed, accel, brake, turn, mass). Tuk-tuk has a leaning wiggle, bike leans into turns. |
| 6 | NPCs | Articulated humanoid peds (torso/head/two legs/two arms) with a shared `animateWalk` cycle and six archetype silhouettes (local, office worker w/ briefcase, tourist w/ cap+backpack, bald monk w/ alms bowl, conical-hatted vendor & laborer, plus a skirt variant). Crowd density follows the time of day (`crowdFactor` — dead 3am, rush-hour/midday busy) and peds spawn onto the sidewalk band (`sidewalkPos`). Behavioral clusters (`buildClusterAnchors`/`updateClusters`) queue customers at food stalls and loiterers at 7-Elevens. `spawnPeds`, `spawnDogs`, `spawnTraffic`. District banners announce Yaowarat / The Wat / Riverside / Sukhumvit on entry. |
| 7 | Rain | Particle points re-centered on the player each frame, opacity fades with weather. |
| 8 | Engine init | Renderer, lights (sun + hemi + ambient), camera, audio, world build, player, vehicles, peds, dogs. Loading bar + start gate. |
| 9 | HUD | Star/cash/HP/stamina/ammo/clock/weather binds, subtitle + prompt + notif queues, phone (T) with live stats (amulets/fares/cops + completion %), full north-up map overlay (TAB), minimap renderer (camera-yaw rotated, mission + taxi markers, amulet + snatcher + cop dots). |
| 10 | Mission system | Stage-based; the `welcome` mission listens for player proximity to the gold shop POI. Add more to the `missions` object. |
| 11 | Collisions | AABB pushback for player and vehicle vs buildings. World-bound clamping. |
| 12 | Player update | Movement, sprint+stamina, jump, in-vehicle controls, exit on E, leg-bob animation, 7-Eleven door chime trigger. |
| 13 | Peds + Dogs | Wander state machines; peds panic when attacked; dogs scatter when player approaches, settle back when far. |
| 14 | Combat | Muay Thai jab/cross/kick (animated arm/leg swings), pistol + full-auto SMG + pellet-spread shotgun fire (raycast hit + tracer sphere + muzzle flash + camera shake), reload. Pistol on first cop kill; SMG drops from a destroyed 3★ Fortuner; shotgun/SMG also buyable at the gun shop. |
| 15 | Cops + Wanted | Star-based heat with decay after 35 s out of sight. Spawns foot cops at 1★, cop-pickup chase cars at 2★, unmarked Crime Suppression Fortuners + spike strips at 3★ (after ~3 cop kills), armored SWAT vans at 4★ (after ~6 kills); a star increase flashes the HUD and whoops a siren; nights run one extra unit. Bribe with B near a foot cop (1–2★ only). |
| 16 | Particles / FX | Smoke emitter (vehicles below 30% HP), explosion (light flash + smoke + camera shake + thunder SFX). |
| 17 | Interaction | Vehicle proximity check + E to enter. |
| 18 | Camera update | Follow rig with smoothed distance, shake decay, in-vehicle chase view auto-aligns to vehicle heading. |
| 19 | Day/Night + Weather | 8-min day cycle drives sun position (tilted so noon actually sunlights the facades), sky/fog colours, neon and street-lamp intensity; the sun + shadow camera track the player. Monsoon weather cycle (clear ⇄ drizzle/downpour that builds and breaks) with lightning flashes during heavy rain. Dawn temple bell at 5–6 AM. |
| 20 | Main loop | Single `loop()` calls every system in order. |

The mutable global is `window.GAME`. Useful while developing:

```js
GAME.player.hp = 100;
GAME.cash = 99999;
GAME.wanted.stars = 0;
GAME.time.dayT = 0.85;          // 8:24 PM — neon comes alive
GAME.time.weather = 'rain';     // force monsoon
GAME.player.weapons.pistol = true; GAME.player.pistolAmmo = 12;
```

## Saving

Progress (cash, weapons + ammo, armor, amulets found, time of day, position, and
now property — the safehouse, the rented garage, and every stored car with its
colour/plate/condition) autosaves to `localStorage` every ~8 s and on exit, and
restores on reload. New property fields are additive, so old `gtabkk_save_v1`
saves still load (they just start without property). If the intro delivery was
done, you respawn straight into free roam with Soi Run available. Wipe the save
to start fresh:

```js
localStorage.removeItem('gtabkk_save_v1');
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
- Collisions are AABB pushback, not rigid body. Bumping a wall at speed loses
  velocity but doesn't bounce realistically.
- Traffic AI is grid-aware but doesn't yield at intersections — a few honks per
  block at rush hour, which is admittedly authentic.
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
mostly dynamic — vehicles, peds, dogs, the rooftop/lamp/wire `InstancedMesh`
batches — plus a few one-off landmarks. A busy midday crowd (the articulated
peds are ~7 meshes each, frustum-culled) adds a few hundred calls when the
sidewalks are full, landing the noon view around ~800; the small hours drop back
toward the ~370 floor. If it still chugs, lower `PED_TARGET`, raise the
pedestrian/traffic despawn radius, or drop pixel ratio.

Repeated props (rooftop tanks/AC/antennas, lamps, poles, wires, Yaowarat
lanterns, parked bikes) use `InstancedMesh`; pooled materials with night-emissive
ramps are shared, so the per-frame day/night loop touches ~a dozen materials,
not hundreds.

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

## Roadmap (Phase 2+)

See `gta.md` for the full vision. Next likely additions: Yaowarat (no-cars
zone), more missions, expanded vehicle roster.

**Build the prototype. Ship it. Iterate.**

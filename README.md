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

Three.js is fetched at runtime via importmap from jsdelivr; you need internet
on first load. Click **ENTER THE CITY** when the loader finishes.

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
| J | Start a taxi fare (in a songthaew) |
| T | Phone — pauses pointer lock and shows menu |
| G | *(dev)* grant 9mm pistol |
| Esc | Release mouse |

## Tutorial mission

You start at Hua Lamphong with ฿100 cash. A motorbike and a tuk-tuk are parked
beside the platform. Drive (or run) to the **gold pillar of light** marker at
Uncle Seng's gold shop in the south-west corner of the map. ฿800 reward on
arrival. After that the world is open — try the bike, hit peds (gain stars),
bribe your way out, watch the rain roll in.

**Soi Run (mission 2).** Once you've delivered the envelope, Uncle Seng has a
second job. Leave his shop and return to the **pink marker** to start *Soi Run* —
a timed checkpoint race (you'll want the bike). Reach each cyan checkpoint before
the clock runs out; every one buys you extra seconds. ฿1,500 on completion, and
it's replayable from the start line. Tune the timer/route via `startTime`,
`cpBonus`, and `route` in the `soiRun` mission object.

**The Hit (mission 3).** Winning Soi Run unlocks it. Return to the marker to
start, then drive to Soi 80 and eliminate the four **marked crew** (pink
markers over their heads) — fists, pistol, or the SMG. They scatter when
attacked and the gunfire draws cops, so it doubles as a wanted-level/escape
loop (duck into the U-Spray after). ฿2,000 on completion, replayable.

**Amulets.** 15 glowing gold amulets are hidden across the districts. Each is
฿100, and finding all of them pays a ฿2,000 bonus — an excuse to explore.

**Taxi (free-roam job).** Grab a red songthaew, press **J**, drive to the yellow
marker to pick up a fare, then to the green marker before the timer runs out.
Pay scales with distance. It's a standalone activity, separate from the story
missions, so you can run fares any time.

## Architecture

Everything lives in two files:

- `index.html` — DOM shell, HUD overlays, importmap. No game logic.
- `main.js` — the entire engine. Organised into numbered sections:

| § | Section | Notes |
|---|---|---|
| 1 | Audio | Procedural Web Audio. Engine loopers, 7-Eleven chime, temple bell, footsteps, gunshots, sirens, rain bed. |
| 2 | Input | Keyboard set + pointer-lock mouse deltas + `pressed` (edge) helper. |
| 3 | World | Procedural 10×10 block grid (BLOCK=50m), road grid, buildings with neon strips and lit-window planes, BTS Skytrain elevated track, street lamps, 7-Elevens, spirit-house shrines, gold-shop POI with pillar of light, temple compound, a U-Spray garage (drive a vehicle in to repair it and clear your wanted level for ฿500), a Yaowarat Chinatown market street (paifang gate, dense shophouses, hanging lanterns, market stalls), and a Chao Phraya river down the west edge (water + embankment + pier + longtail boats). Repeated props use `InstancedMesh`. Builds an off-screen canvas as the minimap base. |
| 4 | Player + Camera | Capsule character (torso/legs/head/arms), arcade third-person camera rig (orbit yaw/pitch/distance, shake decay). |
| 5 | Vehicles | `makeVehicleMesh(kind)` produces bike / tuk-tuk / hilux / cop / camry / sedan with per-kind `spec` (topSpeed, accel, brake, turn, mass). Tuk-tuk has a leaning wiggle, bike leans into turns. |
| 6 | NPCs | Procedural ped/dog meshes with variety (locals, saffron-robed monks, backpacked tourists). `spawnPeds`, `spawnDogs`, `spawnTraffic`. District banners (`updateDistrict`) announce Yaowarat / The Wat / Riverside / Sukhumvit on entry. |
| 7 | Rain | Particle points re-centered on the player each frame, opacity fades with weather. |
| 8 | Engine init | Renderer, lights (sun + hemi + ambient), camera, audio, world build, player, vehicles, peds, dogs. Loading bar + start gate. |
| 9 | HUD | Star/cash/HP/stamina/ammo/clock/weather binds, subtitle + prompt + notif queues, phone (T) with live stats (amulets/fares/cops), full north-up map overlay (TAB), minimap renderer (camera-yaw rotated, mission + taxi markers + cop dots). |
| 10 | Mission system | Stage-based; the `welcome` mission listens for player proximity to the gold shop POI. Add more to the `missions` object. |
| 11 | Collisions | AABB pushback for player and vehicle vs buildings. World-bound clamping. |
| 12 | Player update | Movement, sprint+stamina, jump, in-vehicle controls, exit on E, leg-bob animation, 7-Eleven door chime trigger. |
| 13 | Peds + Dogs | Wander state machines; peds panic when attacked; dogs scatter when player approaches, settle back when far. |
| 14 | Combat | Muay Thai jab/cross/kick (animated arm/leg swings), pistol + full-auto SMG fire (raycast hit + tracer sphere + muzzle flash + camera shake), reload. Pistol on first cop kill; SMG drops from a destroyed 3★ Fortuner. |
| 15 | Cops + Wanted | Star-based heat with decay after 35 s out of sight. Spawns foot cops at 1★, cop-pickup chase cars at 2★, unmarked Crime Suppression Fortuners at 3★ (after a few cop kills). Bribe with B near a foot cop (1–2★ only). |
| 16 | Particles / FX | Smoke emitter (vehicles below 30% HP), explosion (light flash + smoke + camera shake + thunder SFX). |
| 17 | Interaction | Vehicle proximity check + E to enter. |
| 18 | Camera update | Follow rig with smoothed distance, shake decay, in-vehicle chase view auto-aligns to vehicle heading. |
| 19 | Day/Night + Weather | 4-min day cycle drives sun position, sky/fog colours, neon and street-lamp intensity. Rain phase kicks in after ~90 s. Dawn temple bell at 5–6 AM. |
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

Progress (cash, weapons + ammo, armor, amulets found, time of day, and position)
autosaves to `localStorage` every ~8 s and on exit, and restores on reload. If
the intro delivery was done, you respawn straight into free roam with Soi Run
available. Wipe the save to start fresh:

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
- No pathfinding for cops; they steer directly at the player. At 2★ they ram
  with their pickups.
- Audio is fully synthesised. No radio stations yet (Phase 2 — would need
  hand-built procedural music or licensed-free tracks).

## Performance

Targets 60 FPS at 1080p on integrated GPUs. Most cost is the ~120 emissive
window planes and ~80 simultaneous meshes (vehicles + peds + dogs). If it
chugs, raise the pedestrian/traffic despawn radius or drop pixel ratio.

## Roadmap (Phase 2+)

See `gta.md` for the full vision. Next likely additions: Yaowarat (no-cars
zone), more missions, expanded vehicle roster.

**Build the prototype. Ship it. Iterate.**

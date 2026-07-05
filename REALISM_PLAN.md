# Realism Improvement Plan

A self-contained implementation plan to make the game feel dramatically more
realistic, in priority order. Written after a code audit of the current build;
line numbers were verified against it but **re-grep before editing — they
drift**.

## Ground rules (read first)

- **No build step, no new dependencies, no downloaded assets.** Plain ES
  modules served statically; Three.js r160 is vendored in `vendor/` via
  importmap. Everything below is math on existing meshes plus boot-time
  `CanvasTexture`s.
- **Performance budget is enforced.** The in-game overlay (`~`/F3) and CI
  (`tools/realism_pass_test.mjs`) fail above: 900 draw calls, 450k triangles,
  850 visible meshes, 180 active entities. Target 60 FPS at 1080p on
  integrated GPUs. Do not add per-ped unique textures or per-frame
  `scene.traverse` loops.
- **Validate after every task:** `node tools/smoke.mjs` must pass (boots the
  real game headless, fails on any page error, reports draw calls) and
  `node tools/realism_pass_test.mjs` must stay green. Manual check: serve with
  `python3 -m http.server 8765` and play.
- **`window.GAME` (the `G` global) stays API-stable.** Other modules and the
  test harness read it.
- **One commit per task**, in the order below — each task stands alone and the
  earlier ones have the highest payoff.
- Don't break the special-case vehicles: the **boat** (river-clamped, swell
  bob, `vehicles.js` ≈ 132–137) and the **bike/tuk-tuk cosmetic lean**
  (≈ 121–127) have their own code paths.

Current state, for context: rendering is already strong — `MeshStandardMaterial`
PBR everywhere, PCF soft shadow maps, ACES tone mapping + custom bloom, PMREM
env reflections on glass/car paint, animated `FogExp2`, full day/night/weather.
The realism gaps are **motion** (vehicle physics, collisions, character
animation) and **surface detail** (flat colors, dry-looking rain).

---

## Task 1 — Vehicle dynamics: tire-slip model + visual suspension

**Files:** `vehicles.js` (player drive ≈ lines 75–150), touch `entities.js`
vehicle specs if grip/wheelbase params are added there.

**Today:** pure kinematic arcade. `v.vel` is a scalar forward speed integrated
along `v.heading` (`v.pos.x += sin(heading)*vel*dt`, ≈ 130–131). Yaw comes from
an eased `steerAngle → yawRate → heading` chain with per-kind `turnAssist`
fudge (≈ 104–114). "Drift" is a scripted heading nudge under handbrake
(`v.heading += steerInput * 1.35 * dt`, ≈ 116–119). The body never pitches,
rolls, or slides; Y is fixed except the boat.

### 1a. Lateral-slip (bicycle-ish) model

Keep `v.vel` as forward speed and the existing throttle/brake/coast code
(≈ 82–102) — it's tuned and other systems read `v.vel`. Add a **lateral
velocity channel** `v.latVel` (m/s, positive = sliding right in car space):

1. Replace the yaw computation with a bicycle-model target, blended toward the
   existing arcade response so handling doesn't regress at low speed:
   `yawGeom = (v.vel / wheelbase) * tan(v.steerAngle)`, with
   `wheelbase = spec.wheelbase || 2.6` (bike ≈ 1.3, tuk-tuk ≈ 2.0, pickup ≈ 2.9).
   Blend: `yawTarget = lerp(yawArcadeCurrent, yawGeom, 0.65)` and keep the
   existing easing into `v.yawRate`.
2. Each frame compute demanded lateral acceleration `aLat = v.vel * v.yawRate`.
   Cap it at the grip budget `aMax = (spec.grip || 9) * gripMul` where
   `gripMul = 1 - 0.45 * G.time.rainStrength` (wet roads slide — ties into
   Task 5) and `gripMul *= 0.35` on the rear when handbraking. **Excess demand
   becomes slide:** `v.latVel += (aLat - clamp(aLat, -aMax, aMax)) * dt` — and
   reduce the achieved `v.yawRate` proportionally so understeer plows wide
   instead of rotating.
3. Grip constantly bleeds slide back off:
   `v.latVel -= clamp(v.latVel, -aMax*dt, aMax*dt)`. Under handbrake the bleed
   uses the reduced rear grip, so flicking the wheel + handbrake at speed
   yields a held slide that self-straightens on release — **delete the
   scripted drift nudge at ≈ 116–117** (keep `spawnSkid`, now triggered by
   `Math.abs(v.latVel) > 2.5` instead of the handbrake condition, so slides lay
   rubber whether or not Space is held).
4. Integrate motion with both channels:
   `right = (cos(heading), -sin(heading))`;
   `v.pos.x += sin(heading)*v.vel*dt + right.x*v.latVel*dt;`
   `v.pos.z += cos(heading)*v.vel*dt + right.z*v.latVel*dt;`
5. While sliding, forward speed scrubs off: `v.vel *= 1 - min(0.5, Math.abs(v.latVel) * 0.02) * dt * 60 * 0.01`.
6. Per-spec tuning starting points — pickup `grip 8.5`, sedan/taxi `9.5`,
   tuk-tuk `7.5` (tippy), bike `11` but multiply latVel gain by 0.4 (bikes
   don't four-wheel-slide; they lean, and low grip should instead feed a
   deeper lean angle). Boat: skip entirely (`spec.kind === 'boat'` keeps the
   current path).
7. NPC traffic (`updateTrafficCar`) keeps the simple kinematic path — do NOT
   give NPCs slip; they only need `v.latVel = 0` defaults so shared collision
   code (Task 2) can read the field.

### 1b. Visual suspension (mesh-only — physics stays flat)

Add to the end of the player-drive update (and a lighter version inside
`updateVehicleVisuals` so NPC cars get it too):

- **Pitch** (nose dive/squat): target `pitch = clamp(-accelForward * 0.006, -0.05, 0.06)`
  where `accelForward = (v.vel - v._prevVel)/dt`; spring toward it with
  `v._pitch = lerp(v._pitch, target, 1 - pow(0.001, dt))`.
- **Roll** (lean out of corners): `roll = clamp((aLatAchieved + v.latVel*2) * 0.01, -0.09, 0.09)`,
  same spring. For bikes, invert and triple it and merge with the existing lean
  code at ≈ 122–123 (lean INTO corners); tuk-tuk keeps its wiggle added on top.
- **Vertical bounce**: a damped spring `v._suspY` (stiffness ≈ 55, damping ≈ 8)
  excited by impacts (hook Task 2 passes impulse magnitude in) and by a small
  hash-noise kerb rumble when `Math.abs(v.latVel) > 1` or off-road.
- Apply to the **mesh only**: `v.mesh.rotation.x = v._pitch`,
  `rotation.z += roll` (after the heading set at ≈ 139, note rotation order),
  `v.mesh.position.y = v.pos.y + v._suspY`. `v.pos` itself stays on the ground
  plane so all AABB collision/enter-exit logic is untouched.

**Acceptance:** handbrake at >40 km/h + steer produces a countersteerable
slide with skid decals; braking hard visibly dips the nose; corners roll the
body; rain measurably lengthens stopping/sliding; tuk-tuk feels tippier than
the pickup; boat and NPC traffic behave exactly as before; smoke test green.

---

## Task 2 — Collision impulses (momentum exchange)

**Files:** `physics.js` (`resolveVehicleVsBuildings` ≈ 96–124,
`resolveVehicleVsVehicles` ≈ 126–196).

**Today:** buildings do AABB position pushback then `v.vel *= 0.4` — a bumper
zone, no bounce, no deflection. Vehicle-vs-vehicle does overlap-share pushback
plus a hand-tuned `_impactVX/VZ/Spin` shove on the target when the player rams.

### 2a. Buildings

After computing the pushback axis (which face was hit gives the normal `n`),
decompose the car's world velocity (forward `v.vel` along heading **plus**
`v.latVel` along right — from Task 1) into normal/tangent components:

- Reflect the normal component with restitution `e = 0.25`:
  glancing hits now deflect and continue along the wall instead of stopping.
- Keep ~80% of the tangential component (scrape friction).
- Write the result back into the `(v.vel, v.latVel)` frame, and add yaw kick:
  `v.yawRate += sign(offsetAlongCar) * normalSpeed * 0.15` clamped ±1.5, where
  `offsetAlongCar` is the contact point's forward offset (front-corner hits
  spin you around, mid-body hits don't).
- Keep all existing damage/`camRig.shake`/`spawnDust`/audio exactly as is,
  but scale damage by **normal** speed, not total speed, so wall-scraping at
  speed grinds paint instead of instantly totaling the car. Excite the Task 1b
  suspension spring with the impulse.

### 2b. Vehicle vs vehicle

Replace the canned shove (≈ 154–179) with a real 1D impulse along the contact
normal, keeping the existing overlap-separation shares and all the
gameplay hooks (damage windows, `ramPanic`, dust, shake, audio):

```
m1 = v.spec.mass || 1500; m2 = o.spec.mass || 1500
relN = (v_world - o_world) · n            // closing speed along normal
if relN < 0: j = -(1 + e) * relN / (1/m1 + 1/m2)   // e = 0.3
apply +j*n/m1 to v and -j*n/m2 to o        // decompose back into each
                                           // car's (vel, latVel) frame
spin: each car gets yawRate += (contact offset × impulse) * 0.0004, clamped
```

For NPC targets, ALSO fold the impulse into the existing `_impactVX/VZ`
decay channel (their controller re-asserts lane velocity every frame, so a
raw `vel` write alone gets eaten) — compute the shove from `j/m2` instead of
today's magic numbers. Cap the total as now (≈ 22 m/s). The mass ratio should
now do the work: a pickup rams a bike into orbit; the bike barely moves the
pickup.

**Acceptance:** head-on into a wall at speed bounces you back slightly;
a 30° wall hit deflects you along the wall with a spin; T-boning a lighter car
launches it convincingly while a heavier one barely budges; existing ram
mission/`ramPanic` behavior still triggers; `tools/realism_pass_test.mjs`
(which exercises ramming) stays green.

---

## Task 3 — Character animation: joints, foot planting, gait, head look

**Files:** `entities.js` (`makePedMesh` ≈ 603–740, player rig ≈ 33–79,
`animateWalk`, `makePedLodProxy` ≈ 206), `player.js` (walk anim ≈ 66–99),
`npcs.js` (`updatePeds` ≈ 113–270).

**Today:** peds/player are capsule-limb Groups; one shared sine gait swings
whole rigid legs/arms from hip/shoulder (`stride = sin(t*speed)`,
counter-rotation, torso bob). Reads as Lego-minifig. No knees/elbows, feet
skate, all peds walk in identical lockstep, heads never move.

### 3a. Two-segment limbs

In the `limb()` helper pattern (`entities.js` ≈ 661–665): build legs as
**thigh + shin**, arms as **upper + forearm**, where the lower segment is a
child Group of the upper, positioned at the joint (geometry already offsets
origins to the pivot — reuse that trick). Keep total mesh count in check:
this doubles limb meshes per ped (~8 extra), which at ~60 near peds is fine,
but do **not** add segments to the far-LOD proxy — `makePedLodProxy` stays a
box. Expose the new nodes in the same `parts` object the animators read
(`parts.legL`, plus `parts.shinL`, `parts.armL`, `parts.foreL`, …), and keep
shoes parented to the **shin** so they still ride the swing. Apply the same
split to the player rig (≈ 33–79) so `player.js` can use it. Preserve the
skirt variant (short skin legs) and the cop/recolor material-swap sites —
grep `recolorTorso` before renaming anything.

### 3b. Gait upgrade (shared `animateWalk` + `player.js` block)

- **Knees/elbows:** `knee = max(0, -sin(phase)) * 0.9` on the swinging leg's
  shin (bends on the swing-through, straight at plant); elbows hold a base
  bend ≈ 0.35 plus swing.
- **Foot planting:** drop the rig's hip/group Y by
  `(1 - cos(strideAmplitude)) * legLen * 0.18` so legs stay "connected" to the
  ground through the stride instead of scissoring in air. This plus knees
  kills most visible foot-skating without real IK.
- **Speed-blended gait:** stride amplitude and frequency scale with actual
  move speed; above run threshold add forward torso lean (≈ 0.12 rad) and
  bigger arm swing. Idle gets a barely-visible breathing bob
  (`torso.position.y ± 0.004` at 0.25 Hz).
- **Per-ped variation:** at spawn give each ped `gaitFreq = rand(0.9, 1.12)`,
  `gaitAmp = rand(0.85, 1.1)`, and a random phase offset — this alone breaks
  the lockstep-clone look of crowds.

### 3c. Head look (cheap life signal)

In `updatePeds`, every ~0.4 s per ped (stagger by index, no per-frame cost):
pick a look target — the player if within 8 m or wanted-level chasing, else a
fast vehicle in front, else none. Lerp `head.rotation.y` toward the target
bearing **in body space**, clamped ±1.1 rad, return to 0 when no target. Reuse
the existing panic cone-check code (≈ 117–131) for "fast vehicle" so nothing
new is scanned.

**Acceptance:** walking peds have bending knees and don't foot-skate; a crowd
shows visibly varied walks; peds turn heads at the player's speeding car;
player sprint has lean + bigger swing; showcase mode (`F8`) looks right for
all six archetypes incl. skirt/monk; near-LOD ped count stays ≤ 95 in the
budget overlay.

---

## Task 4 — Procedural surface detail (roads, sidewalks, grime)

**Files:** `world.js` (ground/road/sidewalk mats ≈ 88–97, facade mats
≈ 155–195; follow the existing window-`CanvasTexture` pattern at ≈ 728–767).

**Today:** every surface except the window grid is flat color. Roads
(`0x3a3d42`, roughness 0.85) read as clean plastic; building walls have zero
wear. This is the single biggest "toy town" tell after motion.

Generate **a small number of shared** `CanvasTexture`s at boot (512² each,
`wrapS/T = RepeatWrapping`, `anisotropy = 4`, sRGB for color maps). Budget:
≤ 6 new textures total, reused everywhere — no per-building uniqueness beyond
UV offset.

1. **Asphalt albedo + roughness pair:** dark base with low-contrast value
   noise, sparse cracks (random dark polylines), oil-stain blotches down lane
   centers, tire-wear darkening in two strips per lane. The roughness map
   mirrors it (stains = smoother). Apply as `map`/`roughnessMap` on `roadMat`
   and (tiled larger) `groundMat`; set `repeat` so texel density ≈ one canvas
   per ~12 m. Keep base colors close to the current values so the day/night
   look doesn't shift.
2. **Sidewalk:** concrete-slab joint lines every ~1.5 m + noise + occasional
   stain, on `sidewalkMat`.
3. **Facade grime:** a vertical-gradient grime texture (dark at bottom,
   streaks descending from "sill" rows) multiplied into the concrete facade
   material (≈ 158–163) via `map` with `color` retained as tint — one shared
   texture, per-building variation from UV scale only. Skip the glass facades
   (they have envMap reflections already) and the window curtain-wall faces
   (they already have maps).
4. **Verify draw calls unchanged** (textures don't add calls, but material
   splits could — reuse the existing material instances, only mutate them).

**Acceptance:** streets show wear/stains/cracks at street level and from the
default cam; buildings darken toward the ground with streaking; noon and
night screenshots from `tools/smoke.mjs` still look coherent (no washed-out
or double-dark surfaces); draw calls within budget.

---

## Task 5 — Wet-weather ground response

**Files:** `daynight.js` (rain state ≈ 72–92), `world.js` (export references
to `roadMat`/`sidewalkMat`/`groundMat` or stash them on `G.world.mats`).

**Today:** rain exists (strength lerp, fog, GPU rain points, audio, footstep
splash) but **the ground doesn't respond** — streets stay dry-looking in a
downpour.

- Stash base values at build time (`mat._dryRoughness` etc.). Each frame in
  the day/night update (this is ~3 pooled materials, same pattern as the
  cached emissive arrays — cheap):
  `roadMat.roughness = lerp(dry, 0.12, rainStrength)`,
  `metalness = lerp(0, 0.25, rainStrength)`, and assign `G.envMap` with
  `envMapIntensity = rainStrength * 1.2` so the sky/neon smears across wet
  asphalt. Slightly darken `color` toward wet-asphalt (multiply 0.75).
  Sidewalk gets a half-strength version.
- **Puddles:** ~40 static `CircleGeometry` decals scattered on road edges at
  world build (positions from the road grid, seeded), sharing ONE material:
  near-black, `roughness 0.05`, `metalness 0.6`, envMap on, `opacity =
  rainStrength` (fade in/out), `depthWrite false`, tiny Y offset above skid
  decals. One material mutation per frame; they can linger fading for the
  ~30 s after rain ends for free "just rained" feel.
- Tie-in already built in Task 1: `gripMul` drops with `rainStrength`, so wet
  streets *drive* wet too.

**Acceptance:** during a downpour streets go visibly glossy with reflected
sky/neon and puddles appear; everything fades back over ~30 s after the rain
breaks; night+rain (neon on wet road) is the money shot — grab it via photo
mode (`P`); no new page errors, budget green.

---

## Task 6 — Traffic & crowd imperfection

**Files:** `vehicles.js` (`updateTrafficCar` ≈ 263–380), `npcs.js`
(`updatePeds` ≈ 113–270, spawn sites).

**Today:** traffic AI is genuinely good (lane-keeping, signal obedience with
committed-clearing, gap-based yielding, contextual honking) but every driver
is the same law-abiding clone. Peds have density curves, panic, crossing
logic, boids separation — but move identically (fixed by 3b) and carry no
props.

- **Driver personality (seeded at spawn):** `cruiseMul rand(0.85, 1.15)` on
  cruise speed; lane-center wander `sin(t * 0.3 + seed) * 0.12` added to
  `laneTarget`; per-driver amber-running: on amber, a driver with
  `seed > 0.7` commits instead of braking (the "clears the box if committed"
  logic already exists — extend its threshold per seed); following-distance
  multiplier `rand(0.8, 1.3)` on the yield gap.
- **Motorbike lane-filtering** (very Bangkok): when a traffic bike's `consider()`
  gap check says blocked and speed < 30% of cruise, offset `laneTarget`
  toward the lane edge to squeeze past slower cars; return to lane center once
  clear ahead. Bikes only, and skip while signal-stopped at a red.
- **Ped props & poses:** phone-walkers (~12% of `local`/`office`/`tourist`
  spawns): one arm posed bent-up holding a small dark box, head pitched down
  0.35 rad, walk speed ×0.8; umbrellas when `rainStrength > 0.4`: one shared
  cylinder+cone prop mesh per equipped ped (~30% of non-monk peds), toggled
  visible, arm raised — build the prop into `makePedMesh` hidden so no runtime
  allocation.
- **Pairs walking together:** `spawnPedGroup` already spawns clusters — link
  pairs (`ped.buddy`) so wander targets are shared and separation keeps them
  ~0.8 m apart, giving couples/friends instead of coincidental neighbors.

**Acceptance:** watch an intersection for two minutes — drivers hold visibly
different speeds/gaps, someone runs an amber, bikes filter to the front at
reds; in rain the crowd sprouts umbrellas; phone-walkers amble slower with
heads down; entity/mesh budgets unchanged (props are pre-built and toggled).

---

## Task 7 — Camera feel

**Files:** `main.js` (camera rig / `camRig`; find the vehicle-follow branch),
`player.js` (sprint).

- **Speed FOV:** in-vehicle, `cam.fov = lerp(base, base + 9, speed01²)` +
  `updateProjectionMatrix` only when it changes > 0.05. Ease back on exit.
- **Follow lag:** lerp the camera's follow distance slightly with
  acceleration (stretch ~+0.6 m under hard accel, compress under braking) so
  speed changes are felt.
- **Sprint head-bob:** tiny (±0.03 m, stride-synced) vertical bob on-foot
  while sprinting only. Respect photo mode (`P`) — no bob/FOV there.
- Impact shake already exists (`G.camRig.shake`) — leave it.

**Acceptance:** flooring the pickup visibly widens FOV and stretches the
camera; braking snaps it back; sprint has a subtle bob; photo mode unaffected;
no motion-sickness-level amplitudes (keep all values at or below the numbers
above).

---

## Final task — Docs & regression sweep

- Update `README.md`: it's stale — e.g. it claims traffic "doesn't yield at
  intersections" (≈ line 248) while the code fully implements yielding and
  signal stops. Reconcile the "known limitations" list with what Tasks 1–7
  changed (vehicle physics and collisions especially).
- Full pass: `node tools/smoke.mjs` (inspect all four screenshots),
  `node tools/realism_pass_test.mjs`, then a manual play session covering:
  drive each vehicle kind incl. boat, handbrake slide, wall scrape, ram an
  NPC car, get wanted + bribe, rain cycle, night drive, `F8` showcase, save/
  load a slot.

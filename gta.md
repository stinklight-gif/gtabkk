# Bangkok 3D — Open World Driving & Action Game

A detailed build prompt for a GTA III-style, third-person 3D open-world game set in Bangkok, playable in a modern browser.

---

## Role & Goal

You are a senior game developer building a **single-file, browser-playable 3D open-world action game set in Bangkok**, in the spirit of GTA III / Vice City but with its own identity rooted in real Thai street culture. Deliver a playable prototype on the first pass, then iterate. Prioritize *feel* (driving, weight, camera, audio) over breadth of content.

---

## Tech Stack

- **Engine:** Three.js (latest stable from CDN, e.g. `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`)
- **Physics:** Rapier3D (WASM) via `@dimforge/rapier3d-compat` — preferred for vehicle dynamics. Fall back to Cannon-es if Rapier is too heavy for the prototype.
- **Audio:** Web Audio API. Tone.js optional for procedural ambience.
- **Input:** Pointer Lock API for mouselook, Gamepad API for controller support.
- **Asset loading:** GLTFLoader for models, DRACOLoader for compression, KTX2Loader for textures. Use procedurally generated geometry where possible for the prototype to keep it single-file.
- **Build:** No build step. Single `index.html` with ES modules. Importmaps for clean imports.
- **Target:** Chrome/Edge/Safari desktop, 60 FPS at 1080p on integrated GPUs. Mobile is a stretch goal.

---

## Visual Direction

Stylized realism — not photoreal, not cartoon. Think *Sleeping Dogs* meets *Persona 5*'s color saturation, with a low-poly base (5–10k tris per building, 2–5k per vehicle) and aggressive use of emissive materials for neon signage. Bloom and color grading do the heavy lifting.

**Palette by district:**
- **Sukhumvit at night** — magenta, cyan, electric blue, hot pink
- **Yaowarat (Chinatown)** — gold, crimson, deep amber
- **Silom** — cold steel, glass, sodium-vapor orange
- **Khao San** — chaotic rainbow neon, string lights
- **Thonburi / khlongs** — muted greens, browns, jade water
- **Chatuchak** — corrugated tin, dust, primary colors under tarps

**Atmosphere:** Heat haze shader during the day. Volumetric fog at dawn. Heavy rain with screen-space wet surfaces. Neon reflections in puddles. Smoke from street food grills. Distant thunderstorms over the Gulf.

---

## World Design

A condensed, stylized Bangkok — not a 1:1 map, but the *feel* of the city. Roughly 4 km² playable area divided into 7 connected districts, separated by the Chao Phraya river and elevated expressways.

### Districts

1. **Sukhumvit** — Wide sois, BTS Skytrain running overhead on concrete pillars, glass condos, malls (Terminal 21, EmQuartier analogues), Soi Cowboy / Nana neon strips. Heavy nightlife traffic.
2. **Silom / Sathorn** — CBD. Skyscrapers, Lumpini Park (green lung, joggers, monitor lizards in the lake), Patpong night market, embassy row.
3. **Yaowarat (Chinatown)** — Narrow lanes, gold shops, food stalls spilling into the street, red lanterns strung overhead, impossible to drive a car through — motorbike or on foot only.
4. **Rattanakosin (Old City)** — Grand Palace silhouette, Wat Pho, Khao San backpacker chaos, tuk-tuk swarms, government buildings.
5. **Chatuchak / Phahonyothin (North)** — Weekend market sprawl, Mo Chit BTS terminus, JJ Mall, bus terminal, more working-class density.
6. **Klong Toey (Port)** — Shipping containers, cranes, the slum community, expressway interchange, gritty industrial. Spawn point for smuggling missions.
7. **Thonburi (across the river)** — Khlong canals, traditional wooden houses on stilts, Wat Arun spire, longtail boat traffic, quieter and greener.

### Connective Tissue

- **Chao Phraya river** running north-south, crossed by 3 bridges (Rama VIII suspension bridge, Taksin, a fictional pedestrian bridge). Boatable.
- **Expressway network** elevated above the city — fast travel, but tolls (the game treats tolls as a minor cash sink, very Bangkok).
- **BTS Skytrain** runs as a moving environmental hazard / Easter egg vehicle. Hijackable at stations as a late-game stunt.
- **Khlong (canal) network** in Thonburi and bisecting parts of the old city — navigable by longtail boat, with low bridges that decapitate standing passengers (dark humor, optional gore toggle).

### Living World

- **Traffic:** Persistent, gridlocked at rush hour, sparse at 3 AM. Motorbikes weave between cars (lane-splitting AI). Tuk-tuks accelerate aggressively. Buses don't yield. Mercedes don't yield harder.
- **Pedestrians:** Office workers in white shirts and black pants (Silom mornings), tourists with cameras (Khao San, Grand Palace), monks at dawn doing alms rounds (do *not* hit them — instant 2-star wanted), street vendors, ladyboys in Nana, schoolkids in uniforms, soi dogs sleeping in the middle of the road.
- **Day/night cycle:** 24-minute full day. Dawn alms round (5–6 AM), morning rush (7–9), midday heat (peds seek shade), evening rush (5–8), nightlife (9 PM–3 AM), dead hours (3–5 AM).
- **Weather:** Sunny, overcast, thunderstorm (monsoon — streets flood, low areas become impassable to cars but boats spawn), haze (burning season).
- **Audio bed:** Tuk-tuk two-stroke buzz, distant temple bells, BTS announcements ("Next station, Asok"), motorbike horns, soi dog barks, rain on tin roofs, 7-Eleven door chime (the iconic "ding-dong"), Thai pop from passing cars, mor lam from upcountry pickup trucks.

---

## Player Character & Story Hook

**Protagonist:** Customizable, but default is **"Nok"** — a former Muay Thai fighter from Isaan (northeast Thailand) who came to Bangkok looking for his sister, got pulled into the orbit of a Chinatown *jao pho* (godfather), and now navigates between Thai-Chinese organized crime, the Royal Thai Police, a rival Russian-Pattaya outfit, and his own moral compromises.

**Opening:** Nok arrives at Hua Lamphong station with a duffel bag and a phone number. The number belongs to **Uncle Seng**, a Yaowarat fixer who runs gold-shop fronts. Tutorial mission: deliver a package across Yaowarat on foot, then upgrade to a stolen motorbike.

The story is optional flavor — open-world sandbox is the main attraction.

---

## Vehicles

Each vehicle has distinct handling. Drive *feel* is the #1 priority.

| Vehicle | Top Speed | Handling | Notes |
|---|---|---|---|
| **Honda Wave motorbike** | Medium | Razor-sharp, lane-splits | Default starter ride. Can fit through Yaowarat alleys. |
| **Tuk-tuk** | Low-medium | Tippy, oversteer-prone | Hilarious physics. Three-wheel chaos. |
| **Toyota Hilux pickup** | Medium-high | Heavy, stable | Can carry passengers in the bed (gang missions). |
| **Grab car (Toyota Camry)** | Medium-high | Boring, reliable | Spawns everywhere. The civic Camry. |
| **Songthaew** | Low | Tank-like | Slow but plows through traffic. |
| **BMW / Benz sedan** | High | Snappy, prestigious | Aggressive AI defends them. |
| **Police pickup (Isuzu D-Max)** | High | Stable, durable | What's chasing you. |
| **Longtail boat** | High (on water) | Loose, fun | Only in khlongs and Chao Phraya. |
| **Lamborghini Huracán** | Very high | Twitchy | Rare spawn in Thonglor. Trophy vehicle. |
| **BTS Skytrain** | Very high | On rails only | Late-game hijack. Pure spectacle. |
| **Ambulance / Fire truck** | Medium | Heavy | Side jobs: paramedic, firefighter (GTA tradition). |

**Damage model:** Visible deformation, broken windows, smoke at 30% health, fire at 10%, explosion at 0%. Tires shoot out independently. Engine stalls force restart.

---

## On-Foot Combat

**Melee — Muay Thai system:**
- Jab, cross, low kick, teep (push kick), roundhouse, knee, elbow
- Clinch (grapple) on prolonged contact — opens up knees, elbow strikes, sweeps
- Block, parry, dodge
- Combo system rewards variety (no jab-spam)
- Stamina meter — drains on attacks and sprinting

**Weapons (escalating tiers):**
- *Improvised:* Somtam pestle, durian (one-use AOE), fish-sauce bottle (blinds), tuk-tuk muffler, plastic chair
- *Bladed:* Cleaver (from Yaowarat market), machete
- *Firearms:* Air pistol → 9mm → shotgun → AK-47 → M16 (military wanted level only) → grenade launcher (cartel mission reward)
- *Special:* Slingshot (Isaan callback), Molotov, brick of C4

**Cover system:** Auto-attach to walls, blind-fire, peek-aim.

---

## Wanted System

Five-tier escalation, each tier has Thai flavor:

1. ⭐ **Tourist Police / Local cops** — Whistle, halfhearted chase, easily bribed (฿500–2,000).
2. ⭐⭐ **Royal Thai Police patrol** — Isuzu D-Max pickups, real pursuit.
3. ⭐⭐⭐ **Crime Suppression Division** — Plain-clothes, unmarked Fortuners, smarter AI, roadblocks.
4. ⭐⭐⭐⭐ **Special Branch + helicopter** — Aerial pursuit, spike strips, district lockdowns.
5. ⭐⭐⭐⭐⭐ **Military / RTA** — Armored Humvees, soldiers with M16s, checkpoints, martial-law atmosphere.

**Reducing heat:**
- **Bribe** — Lower tiers only. Press B near a cop, lose cash, lose a star. Very on-brand.
- **Lose line of sight** — Standard cone-of-vision system, hide in alleys, parking garages, khlongs.
- **Change vehicle + clothes** — Spray shops, clothing stores reset description.
- **Cross a district** — Slight cooldown when entering a new district (different precinct).
- **Wat (temple)** — Safe houses. Enter a temple courtyard, monks shield you, heat slowly bleeds off. Sacred space — even cops won't enter at low tiers.

---

## Mission Design (Prototype Set)

Ship 5 missions in the first build to demonstrate the loop:

1. **"Welcome to Krung Thep"** — Tutorial. Walk from Hua Lamphong to Uncle Seng's gold shop, deliver an envelope. Teaches movement, interaction, minimap.
2. **"Soi Run"** — Steal a motorbike, deliver a package across Yaowarat traffic in under 4 minutes. Teaches driving, mini-map navigation, timer pressure.
3. **"The Lumpinee Bout"** — Fight three rounds at Lumpinee Stadium. Pure Muay Thai combat tutorial. Win = cash + reputation.
4. **"Customs Issue"** — Drive a Hilux from Klong Toey port through traffic, lose a 2-star wanted level, deliver to a Thonglor warehouse. Teaches wanted system + bribing.
5. **"Monsoon"** — A scripted thunderstorm hits. Rescue Uncle Seng's daughter from a flooding soi in Thonburi using a longtail boat. Showcase weather + boat handling + emotional beat.

**Side activities (sandbox):**
- Tuk-tuk taxi runs (Crazy Taxi mode)
- Street food delivery (Grab-style, with stacking spice/heat physics)
- Muay Thai gym training (improves stats)
- Underground motorbike races through Sukhumvit sois at 2 AM
- Photograph 50 hidden shrines (collectible — unlocks a "merit" bonus)
- Beat 20 muggers in Khlong Toey (vigilante)

---

## HUD & UI

Minimalist, top-right minimap, bottom-left health/armor/stamina, bottom-right ammo, top-left wanted stars and cash (฿ symbol).

- Minimap uses real Bangkok-style road grid colors (yellow for arterials, gray for sois, blue for khlongs).
- Mission objectives in soft cream text with Thai-script subtitle (stylistic only — English primary).
- Phone interface (press T) for missions, contacts, map, settings — analogous to GTA V's phone.
- Diegetic where possible: gas gauge in vehicles, no floating health bars on enemies until they're in combat.

---

## Controls

**Keyboard + Mouse (default):**
- WASD — Move / drive
- Mouse — Look / aim
- Space — Jump / handbrake
- Shift — Sprint / boost (vehicles)
- Ctrl — Crouch
- E — Enter/exit vehicle, interact
- F — Melee / fire weapon
- Q — Cycle weapon
- R — Reload
- B — Bribe (when cop is nearby)
- T — Phone
- Tab — Map
- Esc — Pause

**Gamepad:** Standard third-person shooter mapping (Xbox layout default).

---

## Audio

- **Radio stations** (procedural or licensed-free):
  - *Luk Thung FM* — Thai country music
  - *Bangkok Bass 102* — Thai hip-hop, drill
  - *Soi Cowboy Classics* — 80s rock (for the farang audience)
  - *Mor Lam Express* — Upcountry party music
  - *Wat Radio* — Buddhist chanting / dharma talks (used for tense mission cooldowns)
  - *Talk Krungthep* — Comedic AI-generated talk radio about traffic and politics
- **Ambient layer:** District-specific. Yaowarat has wok-clanging and Teochew dialect murmur. Sukhumvit has bass thump from clubs and tuk-tuk horns. Thonburi has cicadas and water laps.
- **SFX:** Vehicle engines sampled per-model, footsteps differ on wet pavement vs. dry, weapon foley, Muay Thai impact sounds (the iconic "thwack" of shin-on-pad).
- **Voice:** Mix of Thai (subtitled) and accented English. Uncle Seng speaks Teochew-inflected Thai. Police bark in Thai. Tourists speak English/Russian/Chinese. Adds texture.

---

## Performance Targets

- **60 FPS** at 1920×1080 on a GTX 1060 / M1 MacBook Air.
- **Draw distance:** 800m for buildings, 200m for pedestrians/vehicles, with aggressive LOD.
- **Pedestrian count:** 60–120 visible at once.
- **Vehicle count:** 40–80 active.
- **Memory budget:** < 2 GB.
- Use **instanced meshes** for repeated geometry (street lamps, signs, identical building modules).
- Use **texture atlasing** for buildings.
- Stream districts as the player approaches; unload distant ones.

---

## Deliverables — Phase 1 Prototype

Before scoping the full world, deliver a **playable vertical slice** containing:

1. One district (Sukhumvit) at full fidelity — ~500m × 500m playable area.
2. Three vehicles: Honda Wave motorbike, tuk-tuk, Toyota Hilux.
3. On-foot movement + basic Muay Thai melee (jab, cross, kick, block).
4. One firearm (9mm pistol).
5. Day/night cycle (compressed to 4 minutes for demo).
6. Light rain weather state.
7. 20–40 traffic vehicles, 30–60 pedestrians.
8. Functional minimap.
9. 1-star and 2-star wanted system with cop AI and bribe mechanic.
10. Tutorial mission ("Welcome to Krung Thep") + free-roam after completion.

Single `index.html` + `main.js` + assets folder. Document the architecture in a `README.md` so the next iteration can add districts/missions modularly.

---

## Anti-Patterns to Avoid

- **Don't** use stock GTA assets, music, or trademarked vehicle models — make it original.
- **Don't** caricature Thai culture. Aim for the affectionate detail of *Sleeping Dogs* with Hong Kong, not a tourist's clichés.
- **Don't** front-load cinematics. Player should be in control within 30 seconds of launch.
- **Don't** lock the player into walking-speed tutorials. The motorbike unlock should come fast.
- **Don't** ignore the **soi dogs**. They are essential ambient life. They scatter when you approach, regroup behind you, occasionally chase motorbikes. This is the soul of Bangkok.
- **Don't** ship without the **7-Eleven door chime**. Non-negotiable.

---

## Stretch Goals (Phase 2+)

- All 7 districts complete
- Full story mode (~15 hours)
- Multiplayer co-op (Colyseus or PartyKit)
- VR mode (WebXR)
- Mod tools for community-made districts
- Photo mode with stylized filters
- Cross-border expansion (Pattaya, Chiang Mai DLC)

---

## Final Note to the Developer

The goal isn't to clone GTA. The goal is to make the **definitive Bangkok game** — a love letter to the city that captures *sanuk* (the Thai concept of fun-as-philosophy), the controlled chaos, the layered class dynamics, the spiritual undercurrent in the most secular street scenes. Get the motorbike feel right, get the soi dogs right, get the temple bells at dawn right, and the rest will follow.

**Build the prototype. Ship it. Iterate.**

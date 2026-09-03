// =============================================================================
// MISSIONS — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, onSoi, inFlood, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { raiseWanted, recolorTorso, spawnPed } from './main.js';
import { makeVehicle } from './entities.js';   // fleeing target car (Repo Run chase)
import { killPed } from './vehicles.js';        // ragdoll a courier / wave hostile on death

// 10. MISSION SYSTEM
// =============================================================================

// Snap a desired heading to the nearest grid cardinal (matches updateTrafficCar's
// DH = [0, PI/2, PI, -PI/2]). Used to point the Repo Run target car's traffic
// driver away from the player so it actually flees on the road network.
const _FLEE_DH = [0, PI / 2, PI, -PI / 2];
function inferFleeDir(h) {
  let best = 0, bd = 9;
  for (let d = 0; d < 4; d++) {
    const dd = Math.abs(Math.atan2(Math.sin(h - _FLEE_DH[d]), Math.cos(h - _FLEE_DH[d])));
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

export function makeMissionSystem() {
  const sys = { active: null };

  // Shared mission marker beam — a single pillar of light reused by whichever
  // mission is active. Pass null to hide it.
  let beam = null;
  function setBeam(pos, color = 0x21f0ff) {
    if (!pos) { if (beam) { G.scene.remove(beam); beam = null; } return; }
    if (!beam) {
      beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.2, 80, 16, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
      );
      G.scene.add(beam);
    }
    beam.material.color.setHex(color);
    beam.position.set(pos.x, 40, pos.z);
  }

  const missions = {
    welcome: {
      name: 'Welcome to Krung Thep',
      th: 'ยินดีต้อนรับสู่กรุงเทพฯ',
      markerPos: null,
      stage: 0,
      onStart() {
        G.hud.setMissionText('Welcome to Krung Thep');
        G.hud.showSubtitle("Uncle Seng's gold shop. Yaowarat. Bring the envelope.", "ร้านทองของลุงเซ้ง");
        this.markerPos = G.world.poi.goldShop.clone();
        this.stage = 1;
        G.hud.showPrompt('Head to the <b>gold marker</b> on the map.', 3);
      },
      update(dt) {
        if (this.stage === 1) {
          const d2 = dist2(G.player.group.position, this.markerPos);
          if (d2 < 7*7) {
            this.stage = 2;
            G.hud.showSubtitle("Uncle Seng: \"Good, kid. The envelope.\"", "ลุงเซ้ง: \"ดีแล้ว ส่งมา\"");
            G._welcomeDone = true;
            G.cash += 1200;
            G.hud.setCash(G.cash);
            if (GAMEPLAY.armor) G.player.armor = Math.min(G.player.armorMax, G.player.armor + 50);
            G.hud.showNotif('Mission complete: +฿1,200, +Armor');
            // remove pillar
            const beam = G.world.poi.goldShopBeam;
            if (beam) { G.scene.remove(beam); G.world.poi.goldShopBeam = null; }
            G.hud.setMissionText('Free Roam · Sukhumvit');
            // Offer the next job: leave and return to the shop to start Soi Run.
            this.stage = 3;
            this.armed = false;
            this.markerPos = G.world.poi.goldShop.clone();
            setBeam(this.markerPos, 0xff2a86);
            setTimeout(() => {
              G.hud.showSubtitle("Uncle Seng: \"Got another job — a soi run. Come back when you're ready.\"", "ลุงเซ้ง: \"มีงานอีก เดี๋ยวมาเอา\"");
            }, 2500);
          }
        } else if (this.stage === 3) {
          // job available: leave the marker, then return to it to begin Soi Run
          const d2 = dist2(G.player.group.position, this.markerPos);
          if (!this.armed && d2 > 18*18) this.armed = true;
          if (this.armed) {
            G.hud.showPrompt('Return to the <b>marker</b> to start <b>Soi Run</b>', 0.4);
            if (d2 < 8*8) sys.start('soiRun');
          }
        }
      },
    },

    // Mission 2 — a timed checkpoint race. Built on the same stage/marker system;
    // tune startTime / cpBonus / route below. Replayable from the start line.
    soiRun: {
      name: 'Soi Run',
      th: 'ซิ่งซอย',
      markerPos: null,
      stage: 0,
      armed: false,
      cp: 0,
      timeLeft: 0,
      startLine: new THREE.Vector3(-150, 0, -150),
      route: [
        new THREE.Vector3(   0, 0, -150),
        new THREE.Vector3( 150, 0,  -50),
        new THREE.Vector3( 150, 0,  100),
        new THREE.Vector3( -50, 0,  150),
        new THREE.Vector3(-200, 0,   50),
      ],
      startTime: 55,   // seconds on the clock when you cross the start line
      cpBonus: 15,     // seconds added per checkpoint reached
      reward: 2500,
      onStart() {
        this.stage = 1;
        this.cp = 0;
        this.timeLeft = 0;
        if (G.world.sois && G.world.sois.length) {
          this.route = G.world.sois.slice(0, 5).map(s => new THREE.Vector3((s.x0 + s.x1) / 2, 0, (s.z0 + s.z1) / 2));
        }
        G.hud.setMissionText('Soi Run');
        G.hud.showSubtitle("Soi Run: race the checkpoints. Get to the green start line.", "ซิ่งซอย — ไปจุดสตาร์ท");
        this.markerPos = this.startLine.clone();
        setBeam(this.markerPos, 0x39ff7a); // green = start
      },
      update(dt) {
        if (this.stage === 1) {
          if (dist2(G.player.group.position, this.markerPos) < 8*8) {
            this.stage = 2;
            this.cp = 0;
            this.timeLeft = this.startTime;
            this.markerPos = this.route[0].clone();
            setBeam(this.markerPos, 0x21f0ff);
            G.hud.showNotif('GO! Hit the checkpoints!');
            G.audio.whistle();
          }
        } else if (this.stage === 2) {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) { this.fail(); return; }
          const v = G.player.inVehicle;
          if (v && v.spec && !['bike', 'tuktuk', 'boat'].includes(v.spec.kind) && onSoi(v.pos.x, v.pos.z)) {
            if (Math.abs(v.vel) > 6) v.vel = Math.min(v.vel, 5);
            G.hud.showPrompt('SOI too tight — use a bike', 0.4);
          } else {
            G.hud.showPrompt(`SOI RUN &nbsp; ⏱ ${this.timeLeft.toFixed(1)}s &nbsp;·&nbsp; CP ${this.cp + 1}/${this.route.length}`, 0.4);
          }
          if (dist2(G.player.group.position, this.markerPos) < 8*8) {
            this.cp++;
            if (this.cp >= this.route.length) { this.win(); return; }
            this.timeLeft += this.cpBonus;
            this.markerPos = this.route[this.cp].clone();
            setBeam(this.markerPos, 0x21f0ff);
            G.hud.showNotif(`Checkpoint ${this.cp}/${this.route.length} · +${this.cpBonus}s`);
            G.audio.blip({ freq: 760, dur: 0.08, gain: 0.12 });
          }
        } else if (this.stage === 5) {
          // job available — leave, then return to the marker to start the next job
          const d2 = dist2(G.player.group.position, this.markerPos);
          if (!this.armed && d2 > 18*18) this.armed = true;
          if (this.armed) {
            const label = this.nextJob === 'hit' ? 'start <b>The Hit</b>' : 'run <b>Soi Run</b> again';
            G.hud.showPrompt('Return to the <b>marker</b> to ' + label, 0.4);
            if (d2 < 8*8) {
              this.armed = false;
              if (this.nextJob) sys.start(this.nextJob); else this.onStart();
            }
          }
        }
      },
      win() {
        G.cash += this.reward;
        G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G._soiRunWon = true;
        G.hud.showNotif(`Soi Run complete: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Uncle Seng: \"Fast hands, fast wheels. There's other work...\"", "ลุงเซ้ง: \"เร็วดีนี่ มีงานอีก\"");
        this.toReoffer('hit');   // winning unlocks The Hit
      },
      fail() {
        G.hud.showNotif('Soi Run failed — out of time');
        G.hud.showSubtitle("Uncle Seng: \"Too slow. Try again.\"", "ลุงเซ้ง: \"ช้าไป ลองใหม่\"");
        this.toReoffer(null);    // retry Soi Run
      },
      toReoffer(next) {
        this.stage = 5;
        this.armed = false;
        this.nextJob = next || null;
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.startLine.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
    },

    // Mission 3 — a combat hit: chase down and eliminate a 4-person crew.
    hit: {
      name: 'The Hit',
      markerPos: null,
      stage: 0,
      armed: false,
      nextJob: null,
      targets: [],
      base: new THREE.Vector3(80, 0, -80),
      spots: [
        new THREE.Vector3(  80, 0,  -80),
        new THREE.Vector3(-110, 0,   30),
        new THREE.Vector3( 120, 0,  120),
        new THREE.Vector3( -40, 0, -150),
      ],
      reward: 4000,
      onStart() {
        this.stage = 1;
        this.targets = [];
        this.base = pick(this.spots).clone();   // vary the location each run
        for (let k = 0; k < 4; k++) {
          const ped = spawnPed(G.scene, new THREE.Vector3(this.base.x + rand(-7, 7), 0, this.base.z + rand(-7, 7)));
          ped.isTarget = true;
          ped.speed = rand(2.2, 3.0);
          recolorTorso(ped.mesh.userData.parts, 0x1a1a1a, 0.7);
          // own material per marker so disposing one dead target can't break the others
          const mk = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0xff2a86, emissive: 0xff2a86, emissiveIntensity: 0.8, roughness: 0.5 }));
          mk.position.set(0, 2.5, 0); ped.mesh.add(mk);
          this.targets.push(ped);
        }
        this.markerPos = this.base.clone();
        setBeam(this.base, 0xff2a86);
        G.hud.setMissionText('The Hit');
        G.hud.showSubtitle("Uncle Seng: \"Four of 'em at the marker. Take them out.\"", "ลุงเซ้ง: \"จัดการให้ที\"");
        G.hud.showPrompt('Eliminate the <b>marked crew</b> (0/4)', 3);
      },
      update(dt) {
        if (this.stage === 1) {
          let dead = 0, near = null, nd = Infinity;
          for (const t of this.targets) {
            if (t.dead) { dead++; continue; }
            const d = dist2(t.mesh.position, G.player.group.position);
            if (d < nd) { nd = d; near = t; }
          }
          G.hud.showPrompt(`The Hit — crew down ${dead}/${this.targets.length}`, 0.4);
          if (near) { this.markerPos = near.mesh.position; setBeam(near.mesh.position, 0xff2a86); }
          if (dead >= this.targets.length) this.win();
        } else if (this.stage === 5) {
          const d2 = dist2(G.player.group.position, this.markerPos);
          if (!this.armed && d2 > 18*18) this.armed = true;
          if (this.armed) {
            const label = this.nextJob ? 'start <b>Hot Delivery</b>' : 'run <b>The Hit</b> again';
            G.hud.showPrompt('Return to the <b>marker</b> to ' + label, 0.4);
            if (d2 < 8*8) { this.armed = false; if (this.nextJob) sys.start(this.nextJob); else this.onStart(); }
          }
        }
      },
      win() {
        this.stage = 5;
        this.armed = false;
        G.cash += this.reward;
        G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G._hitDone = true;
        this.nextJob = 'delivery';   // winning the Hit unlocks Hot Delivery
        G.hud.showNotif(`Hit complete: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Uncle Seng: \"Clean enough. There's a hot run if you want it.\"", "ลุงเซ้ง: \"มีงานด่วน\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.base.clone();
        setBeam(this.base, 0xff2a86);
      },
    },

    // Mission 4 — Hot Delivery: move the goods across town while the heat is maxed.
    delivery: {
      name: 'Hot Delivery',
      markerPos: null,
      stage: 0,
      armed: false,
      timeLeft: 0,
      drop: new THREE.Vector3(-150, 0, 150),
      home: new THREE.Vector3(100, 0, -50),
      startTime: 75,   // generous: you start at 3★ and spike strips can blow your tires
      reward: 6000,
      onStart() {
        this.stage = 1;
        this.timeLeft = this.startTime;
        this.markerPos = this.drop.clone();
        setBeam(this.drop, 0x39ff7a);
        G.hud.setMissionText('Hot Delivery');
        G.hud.showSubtitle("Uncle Seng: \"Hot goods — get them to the drop. Cops are on you.\"", "ลุงเซ้ง: \"ของร้อน รีบไป\"");
        raiseWanted(3);   // you're hot the moment you take the job
      },
      update(dt) {
        if (this.stage === 1) {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) { this.fail(); return; }
          G.hud.showPrompt(`HOT DELIVERY &nbsp; ⏱ ${this.timeLeft.toFixed(0)}s`, 0.4);
          if (dist2(G.player.group.position, this.drop) < 9*9) { this.win(); return; }
        } else if (this.stage === 5) {
          const d2 = dist2(G.player.group.position, this.markerPos);
          if (!this.armed && d2 > 18*18) this.armed = true;
          if (this.armed) {
            G.hud.showPrompt('Return to the <b>marker</b> to start the <b>Mall Job</b>', 0.4);
            if (d2 < 8*8) { this.armed = false; sys.start('mallJob'); }
          }
        }
      },
      win() {
        this.stage = 5; this.armed = false;
        G._deliveryDone = true;
        G.cash += this.reward; G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G.hud.showNotif(`Delivery complete: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Uncle Seng: \"Made it. You're solid, kid.\"", "ลุงเซ้ง: \"เก่งมาก\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.home.clone();
        setBeam(this.home, 0xff2a86);
      },
      fail() {
        this.stage = 5; this.armed = false;
        G.hud.showNotif('Delivery failed — goods lost.');
        G.hud.showSubtitle("Uncle Seng: \"You lost the goods. Damn.\"", "ลุงเซ้ง: \"ของหายหมด\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.home.clone();
        setBeam(this.home, 0xff2a86);
      },
    },

    // Mission 5 — Mall Job: grab the watches from Terminal 21's 2nd floor (ride the
    // escalators up), then the alarm trips and you run the heat to a drop. Uses the
    // multi-floor interior + the wanted/cop system.
    mallJob: {
      name: 'Mall Job',
      markerPos: null,
      stage: 0,
      armed: false,
      nextJob: null,
      drop: new THREE.Vector3(120, 0, -60),
      reward: 8000,
      onStart() {
        this.stage = 1;
        this.markerPos = (G.world.poi.terminal21 || G.world.mall.center).clone();
        setBeam(this.markerPos, 0xff2a86);
        G.hud.setMissionText('Mall Job');
        G.hud.showSubtitle("Uncle Seng: \"Watch shop, 2nd floor of Terminal 21. Grab the goods and run.\"", "ลุงเซ้ง: \"ขึ้นชั้นสองห้างเทอร์มินอล 21\"");
        G.hud.showPrompt('Get to <b>Terminal 21</b> at Asok', 3);
      },
      update(dt) {
        const pp = G.player.group.position;
        if (this.stage === 1) {
          if (dist2(pp, this.markerPos) < 11 * 11) {
            this.stage = 2;
            const shop = (G.world.mall && G.world.mall.shops || []).find(s => s.name === 'Watch Boutique');
            this.markerPos = (shop ? shop.pos : new THREE.Vector3(G.world.mall.center.x, 10, G.world.mall.center.z)).clone();
            setBeam(this.markerPos, 0xff2a86);
            G.hud.showNotif('Inside — take the escalators up to the 2nd floor');
          }
        } else if (this.stage === 2) {
          // floor-aware: must actually be up on the 2nd floor, not below the marker
          if (dist2(pp, this.markerPos) < 4.5 * 4.5 && Math.abs(pp.y - this.markerPos.y) < 3) {
            this.stage = 3;
            raiseWanted(3);                                  // alarm! cops incoming
            if (G.audio && G.audio.siren) G.audio.siren();
            this.markerPos = this.drop.clone();
            setBeam(this.markerPos, 0x39ff7a);
            G.hud.showNotif('Got the watches! Cops incoming — get to the drop!');
            G.hud.showSubtitle("Make a run for it — get the goods to the drop.", "รีบหนีไปจุดส่ง");
          }
        } else if (this.stage === 3) {
          G.hud.showPrompt('MALL JOB &nbsp;→&nbsp; reach the green drop', 0.4);
          if (dist2(pp, this.drop) < 9 * 9) { this.win(); return; }
        } else if (this.stage === 5) {
          const d2 = dist2(pp, this.markerPos);
          if (!this.armed && d2 > 18 * 18) this.armed = true;
          if (this.armed) {
            const label = this.nextJob ? 'start the <b>Getaway</b>' : 'run the <b>Mall Job</b> again';
            G.hud.showPrompt('Return to the <b>marker</b> to ' + label, 0.4);
            if (d2 < 8 * 8) { this.armed = false; if (this.nextJob) sys.start(this.nextJob); else this.onStart(); }
          }
        }
      },
      win() {
        this.stage = 5; this.armed = false;
        this.nextJob = 'getaway';        // the heist unlocks the wheel-man capstone
        G._mallJobDone = true;
        G.cash += this.reward; G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G.hud.showNotif(`Mall Job complete: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Uncle Seng: \"Clean grab. One more — a getaway needs a wheel man.\"", "ลุงเซ้ง: \"งานสะอาด มีงานคนขับรถหนีอีกงาน\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.drop.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
    },

    // Mission 6 (capstone) — Getaway Driver: grab the crew by car, then string
    // together drops under a timer with the heat maxed (4★ → the police chopper
    // is on you). Showcases the cop-chase depth + driving. Escalates to ฿12,000.
    getaway: {
      name: 'Getaway Driver',
      markerPos: null,
      stage: 0,
      armed: false,
      nextJob: null,    // set to 'repoRun' on first clear → opens Nong's side-arc
      dropIdx: 0,
      timeLeft: 0,
      pickup: new THREE.Vector3(-120, 0, -120),
      drops: [
        new THREE.Vector3( 140, 0,  120),
        new THREE.Vector3(-150, 0,  140),
        new THREE.Vector3( 150, 0, -140),
      ],
      startTime: 50,    // seconds once the crew's aboard
      dropBonus: 22,    // seconds added per drop reached
      reward: 12000,
      onStart() {
        this.stage = 1; this.dropIdx = 0; this.timeLeft = 0;
        this.markerPos = this.pickup.clone();
        setBeam(this.markerPos, 0x39ff7a);   // green = pickup
        G.hud.setMissionText('Getaway Driver');
        G.hud.showSubtitle("Uncle Seng: \"Wheel-man job. Grab the crew by car, lose the cops, hit every drop.\"", "ลุงเซ้ง: \"งานคนขับรถหนี\"");
        G.hud.showPrompt('Get a <b>car</b> and reach the green pickup', 3);
      },
      update(dt) {
        const pp = G.player.group.position;
        if (this.stage === 1) {
          const atPickup = dist2(pp, this.markerPos) < 9 * 9;
          if (atPickup && G.player.inVehicle) {
            this.stage = 2;
            this.timeLeft = this.startTime;
            raiseWanted(4);                  // crew aboard → full heat + the chopper
            if (G.audio && G.audio.siren) G.audio.siren();
            this.dropIdx = 0;
            this.markerPos = this.drops[0].clone();
            setBeam(this.markerPos, 0x21f0ff);
            G.hud.showNotif('Crew aboard! Lose the heat — hit the drops!');
          } else if (atPickup) {
            G.hud.showPrompt('Bring a <b>car</b> to the pickup', 0.4);
          }
        } else if (this.stage === 2) {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) { this.fail(); return; }
          G.hud.showPrompt(`GETAWAY &nbsp; ⏱ ${this.timeLeft.toFixed(0)}s &nbsp;·&nbsp; drop ${this.dropIdx + 1}/${this.drops.length}`, 0.4);
          if (dist2(pp, this.markerPos) < 10 * 10) {
            this.dropIdx++;
            if (this.dropIdx >= this.drops.length) { this.win(); return; }
            this.timeLeft += this.dropBonus;
            this.markerPos = this.drops[this.dropIdx].clone();
            setBeam(this.markerPos, 0x21f0ff);
            G.hud.showNotif(`Drop ${this.dropIdx}/${this.drops.length} · +${this.dropBonus}s`);
            G.audio.blip({ freq: 720, dur: 0.08, gain: 0.12 });
          }
        } else if (this.stage === 5) {
          const d2 = dist2(pp, this.markerPos);
          if (!this.armed && d2 > 18 * 18) this.armed = true;
          if (this.armed) {
            // first clear unlocks Nong's side-arc (repoRun); after that, replay the Getaway
            const label = this.nextJob ? 'start <b>Repo Run</b>' : 'drive the <b>Getaway</b> again';
            G.hud.showPrompt('Return to the <b>marker</b> to ' + label, 0.4);
            if (d2 < 8 * 8) { this.armed = false; if (this.nextJob) sys.start(this.nextJob); else this.onStart(); }
          }
        }
      },
      win() {
        this.stage = 5; this.armed = false;
        G.cash += this.reward; G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G._getawayDone = true;
        this.nextJob = 'repoRun';        // capstone clear opens the escalating side-arc
        G.hud.showNotif(`Getaway done: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Uncle Seng: \"Best wheel-man in Krung Thep. My niece Nong's got hotter work — go see her.\"", "ลุงเซ้ง: \"ไปหาน้องนงสิ มีงานเด็ดกว่านี้\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.pickup.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
      fail() {
        this.stage = 5; this.armed = false;
        G.hud.showNotif('Getaway failed — crew bailed.');
        G.hud.showSubtitle("Uncle Seng: \"You blew it. Regroup and try again.\"", "ลุงเซ้ง: \"พลาดแล้ว ลองใหม่\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.pickup.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
    },

    // =========================================================================
    // NONG'S SIDE-ARC — three escalating jobs with NEW objective types, opened by
    // clearing the Getaway capstone. Each chains to the next via `nextJob` using
    // the same leave-then-return stage-5 handshake as the main line, so they reuse
    // the marker/beam/HUD plumbing unchanged. Payouts climb 9k → 11k → 14k.
    // =========================================================================

    // Side-arc 1 — Repo Run (CHASE): a debtor's car bolts; catch it and wreck it
    // (ram it down or shoot it out) before it escapes the cordon or the clock dies.
    // The target drives on the existing traffic AI; we just steer its flee target
    // away from the player and bleed its HP on a hard ram.
    repoRun: {
      name: 'Repo Run',
      markerPos: null,
      stage: 0,
      armed: false,
      nextJob: null,
      car: null,
      timeLeft: 0,
      spawn: new THREE.Vector3(-160, 0, -40),
      startTime: 60,    // catch-it clock once the chase is live
      escapeDist: 170,  // if it gets this far from you, it's gone
      ramCD: 0,
      reward: 9000,
      onStart() {
        this.stage = 1; this.timeLeft = 0; this.ramCD = 0;
        this.clearCar();
        this.markerPos = this.spawn.clone();
        setBeam(this.markerPos, 0x39ff7a);   // green = go to the rendezvous
        G.hud.setMissionText('Repo Run');
        G.hud.showSubtitle("Nong: \"That silver car owes the boss. Box it in and total it.\"", "นง: \"รถคันนั้นติดหนี้ จัดการให้พัง\"");
        G.hud.showPrompt('Get a <b>car</b> and reach the green marker', 3);
      },
      update(dt) {
        const pp = G.player.group.position;
        if (this.stage === 1) {
          if (dist2(pp, this.markerPos) < 11 * 11) {
            // spawn the fleeing car and arm it with a runaway traffic driver
            const v = makeVehicle('luxsedan', G.scene);
            v.pos.copy(this.spawn); v.pos.y = 0; v.heading = 0;
            v.mesh.position.copy(v.pos); v.mesh.rotation.y = v.heading;
            v.npc = { kind: 'flee', dir: 0, turnCD: 0, cruiseSpeed: 16, honkCooldown: 99 };
            v.vel = 8; v.hp = 70;   // a few good rams / a clip of SMG ends it
            this.car = v;
            this.stage = 2; this.timeLeft = this.startTime;
            G.hud.showNotif('There it goes — RAM IT DOWN!');
            G.audio.honk();
          }
        } else if (this.stage === 2) {
          const v = this.car;
          if (!v || v.dead || v.hp <= 0) { this.win(); return; }
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) { this.fail('it slipped the clock'); return; }
          // steer its flee target directly away from the player so it actually runs
          const dx = v.pos.x - pp.x, dz = v.pos.z - pp.z;
          const away = Math.atan2(dx, dz);
          v.npc.dir = inferFleeDir(away);
          const d = Math.hypot(dx, dz);
          if (d > this.escapeDist) { this.fail('it got away'); return; }
          // hard ram: close + fast → bleed its HP (combat handles shooting it)
          this.ramCD = Math.max(0, this.ramCD - dt);
          if (G.player.inVehicle && d < 4 && Math.abs(G.player.inVehicle.vel) > 7 && this.ramCD === 0) {
            v.hp -= 24; this.ramCD = 0.5; G.audio.hit();
            if (G.camRig) G.camRig.shake = Math.max(G.camRig.shake || 0, 0.5);
          }
          this.markerPos = v.pos; setBeam(v.pos, 0xff2a86);
          G.hud.showPrompt(`REPO RUN &nbsp; ⏱ ${this.timeLeft.toFixed(0)}s &nbsp;·&nbsp; HP ${Math.max(0, v.hp | 0)} &nbsp;·&nbsp; ${(d | 0)}m`, 0.4);
        } else if (this.stage === 5) {
          const d2 = dist2(pp, this.markerPos);
          if (!this.armed && d2 > 18 * 18) this.armed = true;
          if (this.armed) {
            const label = this.nextJob ? 'start <b>Cover the Courier</b>' : 'run <b>Repo Run</b> again';
            G.hud.showPrompt('Return to the <b>marker</b> to ' + label, 0.4);
            if (d2 < 8 * 8) { this.armed = false; if (this.nextJob) sys.start(this.nextJob); else this.onStart(); }
          }
        }
      },
      clearCar() {
        const v = this.car;
        if (v && !v.dead) {
          const i = G.vehicles.indexOf(v); if (i >= 0) G.vehicles.splice(i, 1);
          G.scene.remove(v.mesh); disposeObject(v.mesh);
        }
        this.car = null;
      },
      win() {
        this.clearCar();
        this.stage = 5; this.armed = false;
        this.nextJob = 'courier';
        G._repoRunDone = true;
        G.cash += this.reward; G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G.hud.showNotif(`Repo Run complete: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Nong: \"Scrap metal now. There's a courier who needs cover — come back.\"", "นง: \"พังเรียบร้อย มีงานคุ้มกันคนส่งของ\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.spawn.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
      fail(why) {
        this.clearCar();
        this.stage = 5; this.armed = false;
        G.hud.showNotif(`Repo Run failed — ${why}.`);
        G.hud.showSubtitle("Nong: \"You let it go. Try again.\"", "นง: \"ปล่อยหลุดอีกแล้ว ลองใหม่\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.spawn.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
    },

    // Side-arc 2 — Cover the Courier (ESCORT / PROTECT): an on-foot courier walks a
    // fixed route to the drop while gang hitters spawn in and chase him. Keep him
    // alive — clear the heat off him. Fail if he dies. Reuses the gang ped AI: gang
    // peds normally chase the player, so we re-aim the nearest few at the courier.
    courier: {
      name: 'Cover the Courier',
      markerPos: null,
      stage: 0,
      armed: false,
      nextJob: null,
      courier: null,
      foes: [],
      spawnT: 0,
      legIdx: 0,
      start: new THREE.Vector3(60, 0, 60),
      route: [
        new THREE.Vector3(  0, 0,  20),
        new THREE.Vector3(-80, 0, -10),
        new THREE.Vector3(-140, 0, -90),
      ],
      reward: 11000,
      onStart() {
        this.stage = 1; this.legIdx = 0; this.spawnT = 0; this.foes = [];
        this.clearAll();
        this.markerPos = this.start.clone();
        setBeam(this.markerPos, 0x39ff7a);
        G.hud.setMissionText('Cover the Courier');
        G.hud.showSubtitle("Nong: \"Walk my courier to the drop. Hitters will come — keep him breathing.\"", "นง: \"พาคนส่งของไปให้ถึง อย่าให้ตาย\"");
        G.hud.showPrompt('Meet the <b>courier</b> at the green marker', 3);
      },
      update(dt) {
        const pp = G.player.group.position;
        if (this.stage === 1) {
          if (dist2(pp, this.markerPos) < 9 * 9) {
            const c = spawnPed(G.scene, this.start.clone());
            c.isCourier = true; c.isTarget = true;   // isTarget → crowd thinning skips him
            c.state = 'escort';                       // non-'walking' → skip the wander jitter so he holds the route
            c.hp = 120; c.speed = 2.4; c.panicT = 0;
            const parts = c.mesh.userData.parts;
            if (parts && parts.torso) parts.torso.material = new THREE.MeshStandardMaterial({ color: 0xf0c040, roughness: 0.7 });   // hi-vis
            this.courier = c;
            this.stage = 2; this.legIdx = 0; this.spawnT = 3;
            G.hud.showNotif('Courier moving — cover him to the drop!');
            G.audio.whistle();
          }
        } else if (this.stage === 2) {
          const c = this.courier;
          if (!c || c.dead) { this.fail('courier down'); return; }
          // walk the courier leg by leg toward the drop (drive heading/speed; the
          // shared ped move/animate code in updatePeds applies it)
          const goal = this.route[this.legIdx];
          const dx = goal.x - c.mesh.position.x, dz = goal.z - c.mesh.position.z;
          const d = Math.hypot(dx, dz) || 1;
          c.heading = Math.atan2(dx, dz);
          c.speed = 2.4; c.panicT = 0;   // override panic so he keeps walking the route, not fleeing
          if (d < 4) {
            if (++this.legIdx >= this.route.length) { this.win(); return; }
          }
          // spawn waves of hitters that target the courier
          this.spawnT -= dt;
          if (this.spawnT <= 0 && this.foes.filter(f => !f.dead).length < 4) {
            this.spawnT = 5;
            const ang = rand(0, TAU), r = 22;
            const f = spawnPed(G.scene, new THREE.Vector3(c.mesh.position.x + Math.cos(ang) * r, 0, c.mesh.position.z + Math.sin(ang) * r));
            f.gang = true; f.hp = 30; f.speed = 2.8; f._notedAggression = true; f.chaseCourier = c;
            const fp = f.mesh.userData.parts;
            if (fp && fp.torso) fp.torso.material = new THREE.MeshStandardMaterial({ color: 0x3a1020, roughness: 0.8 });
            this.foes.push(f);
            G.hud.showNotif('Hitters incoming!');
          }
          // re-aim hitters at the courier each frame (their default gang AI chases the
          // player; chaseCourier flips the heading + does contact damage to him)
          for (const f of this.foes) {
            if (f.dead || !c || c.dead) continue;
            const hx = c.mesh.position.x - f.mesh.position.x, hz = c.mesh.position.z - f.mesh.position.z;
            const hd = Math.hypot(hx, hz) || 1;
            f.heading = Math.atan2(hx, hz);
            f.speed = hd > 1.5 ? 2.8 : 0;
            f._atkCD = (f._atkCD || 0) - dt;
            if (hd < 1.9 && f._atkCD <= 0) { c.hp -= 12; f._atkCD = 1.0; G.audio.hit(); }
            if (c.hp <= 0 && !c.dead) { killPed(c); }
          }
          this.markerPos = c.mesh.position; setBeam(c.mesh.position, 0xf0c040);
          const alive = this.foes.filter(f => !f.dead).length;
          G.hud.showPrompt(`COURIER &nbsp; ❤ ${Math.max(0, c.hp | 0)} &nbsp;·&nbsp; leg ${this.legIdx + 1}/${this.route.length} &nbsp;·&nbsp; hitters ${alive}`, 0.4);
        } else if (this.stage === 5) {
          const d2 = dist2(pp, this.markerPos);
          if (!this.armed && d2 > 18 * 18) this.armed = true;
          if (this.armed) {
            const label = this.nextJob ? 'start <b>Hold the Yard</b>' : 'run <b>Cover the Courier</b> again';
            G.hud.showPrompt('Return to the <b>marker</b> to ' + label, 0.4);
            if (d2 < 8 * 8) { this.armed = false; if (this.nextJob) sys.start(this.nextJob); else this.onStart(); }
          }
        }
      },
      clearAll() {
        // dispose any leftover courier + hitters so a retry/abort never strands them
        const c = this.courier;
        if (c && !c.dead) { c.dead = true; G.scene.remove(c.mesh); disposeObject(c.mesh); const i = G.peds.indexOf(c); if (i >= 0) G.peds.splice(i, 1); }
        this.courier = null;
        for (const f of this.foes) {
          if (f.dead) continue;
          f.dead = true; G.scene.remove(f.mesh); disposeObject(f.mesh);
          const i = G.peds.indexOf(f); if (i >= 0) G.peds.splice(i, 1);
        }
        this.foes = [];
      },
      win() {
        this.clearAll();
        this.stage = 5; this.armed = false;
        this.nextJob = 'holdYard';
        G._courierDone = true;
        G.cash += this.reward; G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G.hud.showNotif(`Courier delivered: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Nong: \"He made it — clean work. One more, and it's the big one.\"", "นง: \"ส่งถึงแล้ว งานใหญ่รออยู่\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.start.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
      fail(why) {
        this.clearAll();
        this.stage = 5; this.armed = false;
        G.hud.showNotif(`Escort failed — ${why}.`);
        G.hud.showSubtitle("Nong: \"He's gone. Damn it — try again.\"", "นง: \"เขาตายแล้ว ลองใหม่\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.start.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
    },

    // Side-arc 3 (capstone) — Hold the Yard (DEFEND / SURVIVE): stand in the yard and
    // hold it against rolling waves of gang hostiles for the duration. Leave the ring
    // and the clock pauses (so you can't cheese it from afar). Reuses the gang ped AI
    // wholesale: gang peds chase + swing on the player on their own.
    holdYard: {
      name: 'Hold the Yard',
      markerPos: null,
      stage: 0,
      armed: false,
      nextJob: null,
      foes: [],
      holdT: 0,
      spawnT: 0,
      center: new THREE.Vector3(150, 0, 150),
      ringR: 16,          // you must be inside this to bank hold time
      holdTime: 90,       // seconds of holding to win
      maxLive: 7,
      reward: 14000,
      onStart() {
        this.stage = 1; this.holdT = 0; this.spawnT = 0; this.foes = [];
        this.clearFoes();
        this.markerPos = this.center.clone();
        setBeam(this.markerPos, 0x39ff7a);
        G.hud.setMissionText('Hold the Yard');
        G.hud.showSubtitle("Nong: \"Rivals want this yard. Stand in it and hold — don't let them push you out.\"", "นง: \"ยึดลานนี้ไว้ อย่าให้มันไล่\"");
        G.hud.showPrompt('Reach the green <b>yard</b> and hold it', 3);
      },
      update(dt) {
        const pp = G.player.group.position;
        if (this.stage === 1) {
          if (dist2(pp, this.markerPos) < this.ringR * this.ringR) {
            this.stage = 2; this.holdT = 0; this.spawnT = 0.5;
            setBeam(this.center, 0xff2a86);
            G.hud.showNotif('Hold the yard! Waves incoming!');
            G.audio.siren();
          }
        } else if (this.stage === 2) {
          const inRing = dist2(pp, this.center) < this.ringR * this.ringR;
          if (inRing) this.holdT += dt;   // only bank time while you're standing in it
          if (this.holdT >= this.holdTime) { this.win(); return; }
          // roll waves toward the player (gang AI does the chasing/attacking)
          this.spawnT -= dt;
          const alive = this.foes.filter(f => !f.dead).length;
          if (this.spawnT <= 0 && alive < this.maxLive) {
            this.spawnT = rand(1.5, 3.0);
            const ang = rand(0, TAU), r = this.ringR + rand(8, 18);
            const f = spawnPed(G.scene, new THREE.Vector3(this.center.x + Math.cos(ang) * r, 0, this.center.z + Math.sin(ang) * r));
            f.gang = true; f.hp = 35; f.speed = 2.7; f._notedAggression = true;
            const fp = f.mesh.userData.parts;
            if (fp && fp.torso) fp.torso.material = new THREE.MeshStandardMaterial({ color: 0x101a30, roughness: 0.8 });
            this.foes.push(f);
          }
          const left = Math.max(0, this.holdTime - this.holdT);
          G.hud.showPrompt(inRing
            ? `HOLD THE YARD &nbsp; ⏱ ${left.toFixed(0)}s &nbsp;·&nbsp; hostiles ${alive}`
            : `GET BACK IN THE YARD! &nbsp; (${left.toFixed(0)}s left)`, 0.4);
        } else if (this.stage === 5) {
          const d2 = dist2(pp, this.markerPos);
          if (!this.armed && d2 > 18 * 18) this.armed = true;
          if (this.armed) {
            const label = this.nextJob ? 'start <b>Lumpinee Bout</b>' : 'hold the <b>yard</b> again';
            G.hud.showPrompt('Return to the <b>marker</b> to ' + label, 0.4);
            if (d2 < 8 * 8) { this.armed = false; if (this.nextJob) sys.start(this.nextJob); else this.onStart(); }
          }
        }
      },
      clearFoes() {
        for (const f of this.foes) {
          if (f.dead) continue;
          f.dead = true; G.scene.remove(f.mesh); disposeObject(f.mesh);
          const i = G.peds.indexOf(f); if (i >= 0) G.peds.splice(i, 1);
        }
        this.foes = [];
      },
      win() {
        this.clearFoes();
        this.stage = 5; this.armed = false;
        G._holdYardDone = true;
        this.nextJob = 'bout';
        G.cash += this.reward; G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G.hud.showNotif(`Yard held: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Nong: \"The yard's ours. You're the real deal — that's the lot for now.\"", "นง: \"ลานนี้ของเราแล้ว เก่งจริง\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.center.clone();
        setBeam(this.markerPos, 0xff2a86);
      },
    },

    bout: {
      name: 'Lumpinee Bout',
      th: 'มวยลุมพินี',
      markerPos: null,
      stage: 0,
      armed: false,
      nextJob: null,
      foes: [],
      wave: 0,
      center: new THREE.Vector3(80, 0, 80),
      reward: 5000,
      onStart() {
        this.stage = 1; this.wave = 0; this.foes = []; this.clearFoes();
        this.center = (G.world.poi.temple ? G.world.poi.temple.clone() : this.center);
        this.center.x += 18; this.center.z += 8;
        this.markerPos = this.center.clone();
        setBeam(this.markerPos, 0x39ff7a);
        G.hud.setMissionText('Lumpinee Bout');
        G.hud.showSubtitle("Uncle Seng: \"Three rounds. Fists only. Don't gas out.\"", "ลุงเซ้ง: \"สามยก หมัดอย่างเดียว\"");
        G.hud.showPrompt('Reach the <b>ring</b> — fists only', 3);
      },
      spawnWave() {
        this.wave++;
        for (let i = 0; i < this.wave + 1; i++) {
          const a = rand(0, TAU), r = 6;
          const f = spawnPed(G.scene, new THREE.Vector3(this.center.x + Math.cos(a) * r, 0, this.center.z + Math.sin(a) * r));
          f.gang = true; f.hp = 28 + this.wave * 6; f.speed = 2.4; f._notedAggression = true;
          this.foes.push(f);
        }
      },
      update(dt) {
        const pp = G.player.group.position;
        if (this.stage === 1) {
          if (dist2(pp, this.center) < 10 * 10) {
            this.stage = 2; this.spawnWave();
            G.player.activeWeapon = 'fists';
            G.hud.showNotif('Round 1 — jab, jab, cross. Block with Ctrl.');
            setBeam(this.center, 0xff2a86);
          }
        } else if (this.stage === 2) {
          G.player.activeWeapon = 'fists';
          this.foes = this.foes.filter(f => !f.dead);
          G.hud.showPrompt(`BOUT &nbsp; round ${this.wave}/3 &nbsp;·&nbsp; stam ${Math.round(G.player.stam)}`, 0.4);
          if (!this.foes.length) {
            if (this.wave >= 3) { this.win(); return; }
            this.spawnWave();
            G.hud.showNotif('Round ' + this.wave);
            G.audio.whistle();
          }
        } else if (this.stage === 5) {
          const d2 = dist2(pp, this.markerPos);
          if (!this.armed && d2 > 18 * 18) this.armed = true;
          if (this.armed) {
            const label = this.nextJob ? 'start <b>Monsoon</b>' : 'fight the <b>bout</b> again';
            G.hud.showPrompt('Return to the <b>marker</b> to ' + label, 0.4);
            if (d2 < 8 * 8) { this.armed = false; if (this.nextJob) sys.start(this.nextJob); else this.onStart(); }
          }
        }
      },
      clearFoes() {
        for (const f of this.foes) {
          if (f.dead) continue;
          f.dead = true; G.scene.remove(f.mesh); disposeObject(f.mesh);
          const i = G.peds.indexOf(f); if (i >= 0) G.peds.splice(i, 1);
        }
        this.foes = [];
      },
      win() {
        this.clearFoes();
        this.stage = 5; this.armed = false; this.nextJob = 'monsoon';
        G._boutDone = true;
        G.cash += this.reward; G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G.hud.showNotif(`Bout won: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Uncle Seng: \"Hands like that, you can work a storm.\"", "ลุงเซ้ง: \"หมัดดี มีงานหน้าฝน\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.center.clone();
        setBeam(this.center, 0xff2a86);
      },
    },

    monsoon: {
      name: 'Monsoon',
      th: 'มรสุม',
      markerPos: null,
      stage: 0,
      armed: false,
      pickup: null,
      drop: null,
      reward: 7000,
      onStart() {
        this.stage = 1;
        G.time.weather = 'rain'; G._rainTarget = 0.85; G.time.rainStrength = 0.85;
        const fl = (G.world.flood && G.world.flood[0]) || { x0: 60, x1: 80, z0: 60, z1: 80 };
        this.pickup = new THREE.Vector3((fl.x0 + fl.x1) / 2, 0, (fl.z0 + fl.z1) / 2);
        this.drop = (G.world.poi.pier ? G.world.poi.pier.clone() : new THREE.Vector3(-220, 0, -50));
        this.markerPos = this.pickup.clone();
        setBeam(this.markerPos, 0x39ff7a);
        G.hud.setMissionText('Monsoon');
        G.hud.showSubtitle("Uncle Seng: \"The soi's under. Get to the water, then the pier.\"", "ลุงเซ้ง: \"ซอยท่วม ไปท่าเรือ\"");
        G.hud.showPrompt('Reach the flooded soi — a car will stall', 3);
      },
      update(dt) {
        const pp = G.player.group.position;
        if (this.stage === 1) {
          if (dist2(pp, this.pickup) < 10 * 10) {
            this.stage = 2;
            this.markerPos = this.drop.clone();
            setBeam(this.drop, 0x21f0ff);
            G.hud.showNotif('Get to the pier — take the longtail if you can');
          }
        } else if (this.stage === 2) {
          G.hud.showPrompt('MONSOON &nbsp;→&nbsp; the pier', 0.4);
          if (dist2(pp, this.drop) < 12 * 12) { this.win(); return; }
        } else if (this.stage === 5) {
          const d2 = dist2(pp, this.markerPos);
          if (!this.armed && d2 > 18 * 18) this.armed = true;
          if (this.armed) {
            G.hud.showPrompt('Return to the <b>marker</b> to run <b>Monsoon</b> again', 0.4);
            if (d2 < 8 * 8) { this.armed = false; this.onStart(); }
          }
        }
      },
      win() {
        this.stage = 5; this.armed = false;
        G._monsoonDone = true;
        G.cash += this.reward; G.hud.setCash(G.cash); G.hud.cashPop(this.reward);
        G.hud.showNotif(`Monsoon done: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Uncle Seng: \"That's the city, kid. Wet and still moving.\"", "ลุงเซ้ง: \"นี่แหละกรุงเทพ\"");
        G.hud.setMissionText('Free Roam · Sukhumvit');
        this.markerPos = this.drop.clone();
        setBeam(this.drop, 0xff2a86);
      },
    },
  };
  sys.start = id => {
    sys.active = missions[id];
    sys.active.onStart();
  };
  sys.update = dt => {
    if (sys.active && sys.active.update) sys.active.update(dt);
    if (beam) beam.visible = G.state === 'playing';
  };
  sys.missions = missions;
  // Resume from a save: if the intro was done, drop straight into free roam with
  // Soi Run available at its marker (instead of replaying the welcome delivery).
  sys.resume = welcomeDone => {
    if (!welcomeDone) return;
    if (G.world.poi.goldShopBeam) { G.scene.remove(G.world.poi.goldShopBeam); G.world.poi.goldShopBeam = null; }
    sys.active = missions.soiRun;
    missions.soiRun.toReoffer(null);
  };
  return sys;
}

// =============================================================================

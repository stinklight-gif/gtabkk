// =============================================================================
// MISSIONS — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { raiseWanted, spawnPed } from './main.js';

// 10. MISSION SYSTEM
// =============================================================================

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
            G.hud.showNotif('Mission complete: +฿800, +Armor');
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
          G.hud.showPrompt(`SOI RUN &nbsp; ⏱ ${this.timeLeft.toFixed(1)}s &nbsp;·&nbsp; CP ${this.cp + 1}/${this.route.length}`, 0.4);
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
        G.hud.setCash(G.cash);
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
          const parts = ped.mesh.userData.parts;
          if (parts) parts.torso.material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
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
        G.hud.setCash(G.cash);
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
        G.cash += this.reward; G.hud.setCash(G.cash);
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
        G.cash += this.reward; G.hud.setCash(G.cash);
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
            G.hud.showPrompt('Return to the <b>marker</b> to drive the <b>Getaway</b> again', 0.4);
            if (d2 < 8 * 8) { this.armed = false; this.onStart(); }
          }
        }
      },
      win() {
        this.stage = 5; this.armed = false;
        G.cash += this.reward; G.hud.setCash(G.cash);
        G._getawayDone = true;
        G.hud.showNotif(`Getaway done: +฿${this.reward.toLocaleString()}`);
        G.hud.showSubtitle("Uncle Seng: \"Best wheel-man in Krung Thep. That's all I've got — for now.\"", "ลุงเซ้ง: \"คนขับเก่งที่สุด\"");
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
  };
  sys.start = id => {
    sys.active = missions[id];
    sys.active.onStart();
  };
  sys.update = dt => { if (sys.active && sys.active.update) sys.active.update(dt); };
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

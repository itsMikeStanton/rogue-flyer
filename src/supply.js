import * as THREE from "three";
import { terrainHeight, SEA_LEVEL } from "./world.js";

// Air-dropped supply balloon: a parachute + crate that hovers out near the edge
// of the combat zone. It's a friendly "target" — fly through it, gun it, or
// lock a missile onto it to rearm. A blinking beacon helps you find it.
//
// The active drop exposes the shared target interface { position, radius, alive,
// lockable, hit(dmg) } so the player's weapons can hit/lock it; hit() just marks
// it delivered (main does the actual rearm + cleanup).
export class SupplyDrop {
  constructor(scene) { this.scene = scene; this.active = null; this._t = 0; }

  spawn(x, z) {
    const surface = Math.max(terrainHeight(x, z), SEA_LEVEL); // offshore: the sea
    const g = new THREE.Group();
    // Parachute canopy (panelled dome).
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(20, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: 0xeef1f4, flatShading: true, roughness: 0.92, side: THREE.DoubleSide })
    );
    canopy.scale.y = 0.72; canopy.position.y = 9; g.add(canopy);
    // Shroud lines from the canopy rim to a harness above the crate.
    const apex = new THREE.Vector3(0, 1, 0), pts = [];
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 18, 9, Math.sin(a) * 18), apex.clone()); }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xbfc6cc, transparent: true, opacity: 0.55 }));
    g.add(lines);
    // Crate + corner band.
    const crate = new THREE.Mesh(new THREE.BoxGeometry(11, 10, 11), new THREE.MeshStandardMaterial({ color: 0xc8a978, flatShading: true, roughness: 0.85 }));
    crate.position.y = -8; g.add(crate);
    const band = new THREE.Mesh(new THREE.BoxGeometry(11.5, 1.6, 11.5), new THREE.MeshStandardMaterial({ color: 0x6b5b3a, flatShading: true }));
    band.position.y = -8; g.add(band);
    // Blinking beacon up top.
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2810, emissiveIntensity: 4 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 8), beaconMat);
    beacon.position.y = 17; g.add(beacon);

    g.position.set(x, surface + 1500, z); // drops in from high above
    this.scene.add(g);
    this._t = 0;
    this.active = {
      mesh: g, canopy, lines, beacon, beaconMat,
      position: g.position, radius: 24, alive: true, lockable: true, delivered: false,
      hit() { this.delivered = true; },
      drift: new THREE.Vector3((Math.random() - 0.5) * 7, 0, (Math.random() - 0.5) * 7),
      bob: Math.random() * Math.PI * 2, sway: Math.random() * Math.PI * 2,
      descending: true, floated: false, fallV: 0, floatY: surface + 10,
    };
    return this.active;
  }

  update(dt) {
    const d = this.active; if (!d) return;
    this._t += dt; d.sway += dt;
    if (d.descending) {
      // Parachute descent: ease into a terminal speed, swing gently under the canopy.
      d.fallV = Math.min(22, d.fallV + 26 * dt);
      d.mesh.position.y -= d.fallV * dt;
      d.mesh.position.x += Math.sin(d.sway * 0.8) * 6 * dt;
      d.mesh.position.z += Math.cos(d.sway * 0.6) * 6 * dt;
      d.mesh.rotation.z = Math.sin(d.sway * 0.9) * 0.09; // pendulum tilt
      // Touchdown on the water: cut the chute and let the crate float.
      if (d.mesh.position.y <= d.floatY) {
        d.mesh.position.y = d.floatY;
        d.descending = false; d.floated = true; d.bob = 0;
        d.canopy.visible = false; d.lines.visible = false;
        d.beacon.position.y = -1; // beacon now rides just above the crate
        d.radius = 38;            // bigger grab radius so you can still scoop it off the swell
        d.mesh.scale.setScalar(1.4);
      }
    } else {
      // Floating in the swell: bob with the waves and rock side to side.
      d.bob += dt;
      d.mesh.position.x += d.drift.x * 0.3 * dt;
      d.mesh.position.z += d.drift.z * 0.3 * dt;
      d.mesh.position.y = d.floatY + Math.sin(d.bob * 1.4) * 1.8;
      d.mesh.rotation.z = Math.sin(d.bob * 1.1) * 0.13;
      d.mesh.rotation.x = Math.cos(d.bob * 0.9) * 0.09;
      d.mesh.rotation.y += dt * 0.05;
    }
    d.beaconMat.emissiveIntensity = (this._t % 1) < 0.5 ? 5 : 0.3; // blink ~1 Hz
  }

  consume() { if (this.active) { this.scene.remove(this.active.mesh); this.active = null; } }
}

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

  spawn(x, y, z) {
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
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xbfc6cc, transparent: true, opacity: 0.55 })));
    // Crate + corner band.
    const crate = new THREE.Mesh(new THREE.BoxGeometry(11, 10, 11), new THREE.MeshStandardMaterial({ color: 0xc8a978, flatShading: true, roughness: 0.85 }));
    crate.position.y = -8; g.add(crate);
    const band = new THREE.Mesh(new THREE.BoxGeometry(11.5, 1.6, 11.5), new THREE.MeshStandardMaterial({ color: 0x6b5b3a, flatShading: true }));
    band.position.y = -8; g.add(band);
    // Blinking beacon up top.
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2810, emissiveIntensity: 4 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 8), beaconMat);
    beacon.position.y = 17; g.add(beacon);

    g.position.set(x, y, z);
    this.scene.add(g);
    this._t = 0;
    this.active = {
      mesh: g, beaconMat,
      position: g.position, radius: 24, alive: true, lockable: true, delivered: false,
      hit() { this.delivered = true; },
      drift: new THREE.Vector3((Math.random() - 0.5) * 7, 0, (Math.random() - 0.5) * 7),
      bob: Math.random() * Math.PI * 2, baseY: y,
    };
    return this.active;
  }

  update(dt) {
    const d = this.active; if (!d) return;
    this._t += dt; d.bob += dt;
    d.mesh.position.x += d.drift.x * dt;
    d.mesh.position.z += d.drift.z * dt;
    d.mesh.position.y = d.baseY + Math.sin(d.bob) * 4;
    d.mesh.rotation.y += dt * 0.15;
    d.beaconMat.emissiveIntensity = (this._t % 1) < 0.5 ? 5 : 0.3; // blink ~1 Hz
  }

  consume() { if (this.active) { this.scene.remove(this.active.mesh); this.active = null; } }
}

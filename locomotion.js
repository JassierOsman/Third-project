// Moves the player rig. The rig is the only object locomotion touches:
//
//   scene
//    └─ rig        ← locomotion: X/Z position + yaw (world units = metres)
//        └─ xrOffset  ← 0 m for 'local-floor', +eyeHeight for 'local' fallback
//            └─ camera ← desktop: fixed eye height + mouse pitch
//                        VR: real Quest 3 head pose, never modified
//
// Head tracking is never scaled or overwritten; we only move/rotate the space
// the head is tracked in. Rotation pivots around the user's head so turning
// never swings them sideways in the virtual world.

import { CONFIG, DEG } from './config.js';

export class Locomotion {
  constructor({ rig, collision }) {
    this.rig = rig;
    this.collision = collision;
    this.moveRamp = 0;
    this.turnRamp = 0;
    this.speed = 0;     // current signed forward speed, m/s
    this.turnRate = 0;  // current signed turn rate, deg/s (positive = right)
    this.blocked = false;
  }

  stop() {
    this.moveRamp = 0;
    this.turnRamp = 0;
    this.speed = 0;
    this.turnRate = 0;
  }

  /**
   * @param {number} dt seconds (frame-rate independent)
   * @param {{move:number, turn:number}} intent move: -1..1 (forward +), turn: -1 left .. +1 right
   * @param {{x:number, z:number, yaw:number}} head head pose in world space
   */
  update(dt, intent, head) {
    const step = dt / CONFIG.rampTime;

    // Turning (ease in; stop instantly)
    if (intent.turn !== 0) this.turnRamp = Math.min(1, this.turnRamp + step);
    else this.turnRamp = 0;
    this.turnRate = CONFIG.turnSpeed * this.turnRamp * intent.turn;
    let yaw = head.yaw;
    if (this.turnRate !== 0) {
      // Right turn = clockwise seen from above = negative rotation about +Y.
      const angle = -this.turnRate * DEG * dt;
      this.rotateAroundPoint(angle, head.x, head.z);
      yaw += angle;
    }

    // Walking along the head's horizontal facing direction (pitch ignored)
    if (intent.move !== 0) this.moveRamp = Math.min(1, this.moveRamp + step);
    else this.moveRamp = 0;
    const factor = intent.move < 0 ? CONFIG.backwardSpeedFactor : 1;
    this.speed = CONFIG.walkSpeed * factor * this.moveRamp * intent.move;
    this.blocked = false;
    if (this.speed !== 0) {
      const dist = this.speed * dt;
      const dx = -Math.sin(yaw) * dist;
      const dz = -Math.cos(yaw) * dist;
      const res = this.collision.resolveMove(head.x, head.z, dx, dz, CONFIG.bodyRadius);
      this.blocked = res.blocked;
      this.rig.position.x += res.x - head.x;
      this.rig.position.z += res.z - head.z;
    }
  }

  /** Rotate the rig about the vertical axis through world point (px, pz). */
  rotateAroundPoint(angle, px, pz) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const ox = this.rig.position.x - px;
    const oz = this.rig.position.z - pz;
    this.rig.position.x = px + ox * c + oz * s;
    this.rig.position.z = pz - ox * s + oz * c;
    this.rig.rotation.y += angle;
  }

  /** Place the user's HEAD (not the rig origin) at (x, z) facing `yaw`. */
  teleportHeadTo(x, z, yaw, head) {
    this.stop();
    this.rotateAroundPoint(yaw - head.yaw, head.x, head.z);
    this.rig.position.x += x - head.x;
    this.rig.position.z += z - head.z;
  }
}

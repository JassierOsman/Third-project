// Run with:  node --test tests/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, pointSegmentDistanceSq } from '../js/collision.js';
import { Locomotion } from '../js/locomotion.js';
import { CONFIG, DEG } from '../js/config.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function makeRig() {
  return { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } };
}

// Head = rig position + rig rotation applied to a local head offset (like XR room-scale).
function headOf(rig, local = { x: 0, z: 0 }, localYaw = 0) {
  const c = Math.cos(rig.rotation.y), s = Math.sin(rig.rotation.y);
  return {
    x: rig.position.x + local.x * c + local.z * s,
    z: rig.position.z - local.x * s + local.z * c,
    yaw: rig.rotation.y + localYaw,
  };
}

test('point-segment distance', () => {
  close(pointSegmentDistanceSq(0, 1, -1, 0, 1, 0), 1);
  close(pointSegmentDistanceSq(3, 0, -1, 0, 1, 0), 4);
});

test('collision: blocked by wall, slides along it', () => {
  const w = new CollisionWorld();
  w.addSegment(-5, 0, 5, 0, 0.1); // wall along X at z = 0
  assert.equal(w.collides(0, 0.2, 0.2), true);
  assert.equal(w.collides(0, 0.5, 0.2), false);
  // moving diagonally into the wall keeps the X component
  const r = w.resolveMove(0, 0.5, 0.1, -0.3, 0.2);
  close(r.x, 0.1);
  close(r.z, 0.5);
  assert.equal(r.blocked, true);
});

test('collision: rects and disabled world', () => {
  const w = new CollisionWorld();
  w.addRect(0, 0, 1, 1);
  assert.equal(w.collides(1.1, 0.5, 0.2), true);
  assert.equal(w.collides(1.3, 0.5, 0.2), false);
  w.enabled = false;
  assert.equal(w.collides(0.5, 0.5, 0.2), false);
});

test('walk is frame-rate independent', () => {
  const run = (fps) => {
    const rig = makeRig();
    const loco = new Locomotion({ rig, collision: new CollisionWorld() });
    const dt = 1 / fps;
    for (let t = 0; t < 2 - 1e-9; t += dt) loco.update(dt, { move: 1, turn: 0 }, headOf(rig));
    return rig.position.z;
  };
  const a = run(72), b = run(120), c = run(30);
  assert.ok(Math.abs(a - b) < 0.03 && Math.abs(a - c) < 0.05, `${a} ${b} ${c}`);
  // ~2 s at 1.3 m/s minus a short ramp, walking towards -Z
  assert.ok(a < -2.3 && a > -2.65, String(a));
});

test('walk follows head yaw, ignores pitch (yaw only input)', () => {
  const rig = makeRig();
  const loco = new Locomotion({ rig, collision: new CollisionWorld() });
  const head = { x: 0, z: 0, yaw: 90 * DEG }; // looking toward -X
  loco.moveRamp = 1;
  loco.update(0.5, { move: 1, turn: 0 }, head);
  close(rig.position.x, -CONFIG.walkSpeed * 0.5, 1e-9);
  close(rig.position.z, 0, 1e-9);
});

test('releasing stops movement instantly', () => {
  const rig = makeRig();
  const loco = new Locomotion({ rig, collision: new CollisionWorld() });
  loco.update(0.3, { move: 1, turn: 0 }, headOf(rig));
  const z = rig.position.z;
  loco.update(0.3, { move: 0, turn: 0 }, headOf(rig));
  assert.equal(rig.position.z, z);
  assert.equal(loco.speed, 0);
});

test('turning right rotates clockwise about the HEAD, not the rig origin', () => {
  const rig = makeRig();
  const loco = new Locomotion({ rig, collision: new CollisionWorld() });
  const local = { x: 1.0, z: 0.5 }; // user stands 1 m away from the play-space centre
  const before = headOf(rig, local);
  loco.turnRamp = 1;
  loco.update(1.0, { move: 0, turn: 1 }, before);
  const after = headOf(rig, local);
  close(after.x, before.x, 1e-9);
  close(after.z, before.z, 1e-9);
  close(rig.rotation.y, -CONFIG.turnSpeed * DEG, 1e-9);
});

test('teleportHeadTo places head exactly', () => {
  const rig = makeRig();
  rig.position.x = 3;
  rig.rotation.y = 1;
  const loco = new Locomotion({ rig, collision: new CollisionWorld() });
  const local = { x: -0.4, z: 0.7 };
  loco.teleportHeadTo(0, 14, 0, headOf(rig, local, 0.2));
  const h = headOf(rig, local, 0.2);
  close(h.x, 0, 1e-9);
  close(h.z, 14, 1e-9);
  close(h.yaw, 0, 1e-9);
});

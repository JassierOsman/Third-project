// Run with:  node --test tests/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GESTURE, measurePinches, pickCandidate, HandGestureDetector, combineHands, GestureEngine,
} from '../js/gestures.js';
import { CONFIG } from '../js/config.js';

const XR = CONFIG.gestures.xr;
const DT = 1 / 72;

/**
 * Synthetic hand. Hand size (wrist -> middle knuckle) = `size` metres.
 * Fingertips are placed at given distances from the thumb tip.
 */
function makeHand({ size = 0.09, index = 0.09, ring = 0.08, pinky = 0.07 } = {}) {
  const thumb = [0.03, 0.06, 0];
  return {
    tracked: true,
    wrist: [0, 0, 0],
    middleBase: [0, size, 0],
    thumbTip: thumb,
    indexTip: [thumb[0] + index, thumb[1], thumb[2]],
    ringTip: [thumb[0], thumb[1], thumb[2] + ring],
    pinkyTip: [thumb[0], thumb[1] - pinky, thumb[2]],
  };
}

function run(detector, hand, seconds, thresholds = XR) {
  let g = GESTURE.NONE;
  for (let t = 0; t < seconds; t += DT) g = detector.update(hand, DT, thresholds);
  return g;
}

test('measurePinches normalises by hand size', () => {
  const small = measurePinches(makeHand({ size: 0.07, index: 0.014 }));
  const large = measurePinches(makeHand({ size: 0.10, index: 0.020 }));
  assert.ok(Math.abs(small.walk - 0.2) < 1e-9);
  assert.ok(Math.abs(large.walk - 0.2) < 1e-9);
});

test('measurePinches rejects untracked / invalid hands', () => {
  assert.equal(measurePinches(null), null);
  assert.equal(measurePinches({ ...makeHand(), tracked: false }), null);
  assert.equal(measurePinches({ ...makeHand(), indexTip: [NaN, 0, 0] }), null);
  assert.equal(measurePinches(makeHand({ size: 0 })), null);
});

test('thumb + index pinch -> walk', () => {
  const d = new HandGestureDetector(CONFIG.gestures);
  assert.equal(run(d, makeHand({ index: 0.012 }), 0.2), GESTURE.WALK);
});

test('thumb + pinky pinch -> turn right; thumb + ring -> turn left', () => {
  const d1 = new HandGestureDetector(CONFIG.gestures);
  assert.equal(run(d1, makeHand({ pinky: 0.012 }), 0.2), GESTURE.TURN_RIGHT);
  const d2 = new HandGestureDetector(CONFIG.gestures);
  assert.equal(run(d2, makeHand({ ring: 0.012 }), 0.2), GESTURE.TURN_LEFT);
});

test('open hand -> none', () => {
  const d = new HandGestureDetector(CONFIG.gestures);
  assert.equal(run(d, makeHand(), 0.5), GESTURE.NONE);
});

test('dwell debounce: a 1-frame pinch does not activate', () => {
  const d = new HandGestureDetector(CONFIG.gestures);
  assert.equal(d.update(makeHand({ index: 0.01 }), DT, XR), GESTURE.NONE);
  assert.equal(d.update(makeHand(), DT, XR), GESTURE.NONE);
});

test('hysteresis: stays active between press and release thresholds', () => {
  const d = new HandGestureDetector(CONFIG.gestures);
  run(d, makeHand({ index: 0.012 }), 0.2);
  // 0.30 normalised: above press (0.25) but below release (0.36) -> still walking
  assert.equal(d.update(makeHand({ index: 0.09 * 0.30 }), DT, XR), GESTURE.WALK);
  // from idle, the same distance must NOT start walking
  const fresh = new HandGestureDetector(CONFIG.gestures);
  assert.equal(run(fresh, makeHand({ index: 0.09 * 0.30 }), 0.3), GESTURE.NONE);
});

test('release stops instantly (no dwell on release)', () => {
  const d = new HandGestureDetector(CONFIG.gestures);
  run(d, makeHand({ index: 0.012 }), 0.2);
  assert.equal(d.update(makeHand({ index: 0.09 * 0.5 }), DT, XR), GESTURE.NONE);
});

test('lost tracking stops immediately', () => {
  const d = new HandGestureDetector(CONFIG.gestures);
  run(d, makeHand({ index: 0.012 }), 0.2);
  assert.equal(d.update({ ...makeHand(), tracked: false }, DT, XR), GESTURE.NONE);
  assert.equal(d.update(null, DT, XR), GESTURE.NONE);
});

test('multiple pinches: tightest wins, ties go to priority', () => {
  const P = CONFIG.gestures.priority;
  // ring and pinky both under threshold, pinky clearly tighter -> turn right
  assert.equal(pickCandidate({ walk: 1, turnLeft: 0.22, turnRight: 0.12 }, 0.25, 0.03, P), GESTURE.TURN_RIGHT);
  // ring clearly tighter -> turn left
  assert.equal(pickCandidate({ walk: 1, turnLeft: 0.10, turnRight: 0.20 }, 0.25, 0.03, P), GESTURE.TURN_LEFT);
  // near tie between walk and turnLeft -> walk (higher priority)
  assert.equal(pickCandidate({ walk: 0.15, turnLeft: 0.14, turnRight: 1 }, 0.25, 0.03, P), GESTURE.WALK);
});

test('active gesture is latched: other pinches cannot hijack it', () => {
  const d = new HandGestureDetector(CONFIG.gestures);
  run(d, makeHand({ index: 0.012 }), 0.2);
  // pinky closes as well, index still held -> keep walking, never turn
  assert.equal(run(d, makeHand({ index: 0.015, pinky: 0.005 }), 0.3), GESTURE.WALK);
});

test('combineHands: opposite turns cancel, walk + turn combine', () => {
  assert.deepEqual(combineHands({ left: GESTURE.TURN_LEFT, right: GESTURE.TURN_RIGHT }), { walk: false, turn: 0 });
  assert.deepEqual(combineHands({ left: GESTURE.WALK, right: GESTURE.TURN_RIGHT }), { walk: true, turn: 1 });
  assert.deepEqual(combineHands({ left: GESTURE.NONE, right: GESTURE.NONE }), { walk: false, turn: 0 });
});

test('GestureEngine: two hands + source-specific thresholds', () => {
  const engine = new GestureEngine(CONFIG.gestures);
  // 0.30 normalised is a pinch for desktop (press 0.32) but not for xr (press 0.25)
  const hand = makeHand({ index: 0.09 * 0.30 });
  let r;
  for (let i = 0; i < 20; i++) r = engine.update({ left: hand, right: null }, DT, 'desktop');
  assert.equal(r.walk, true);
  assert.equal(r.perHand.left, GESTURE.WALK);
  assert.equal(r.tracked.right, false);
  for (let i = 0; i < 20; i++) r = engine.update({ left: hand, right: null }, DT, 'xr');
  assert.equal(r.walk, false);
});

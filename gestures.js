// Shared gesture engine. Pure JavaScript, no Three.js dependency, so it can be
// unit-tested in Node and fed by either tracking source:
//   - Quest 3 WebXR joint poses   (hand-tracking.js)
//   - MediaPipe world landmarks   (desktop-hands.js)
//
// Hand input format (all points are [x, y, z] in metres, any consistent frame):
//   { tracked, wrist, middleBase, thumbTip, indexTip, ringTip, pinkyTip }

export const GESTURE = Object.freeze({
  NONE: 'none',
  WALK: 'walk',            // thumb + index
  TURN_RIGHT: 'turnRight', // thumb + pinky
  TURN_LEFT: 'turnLeft',   // thumb + ring
});

const FINGER_OF = {
  [GESTURE.WALK]: 'indexTip',
  [GESTURE.TURN_RIGHT]: 'pinkyTip',
  [GESTURE.TURN_LEFT]: 'ringTip',
};

export function distance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Hand size = wrist to middle-finger knuckle (~8–10 cm for adults). */
export function handSize(hand) {
  return distance(hand.wrist, hand.middleBase);
}

/**
 * Normalised thumb-to-fingertip distances (distance / hand size).
 * ~0.15 when touching, ~0.8–1.2 for an open hand. Returns null if invalid.
 */
export function measurePinches(hand) {
  if (!hand || !hand.tracked) return null;
  for (const key of ['wrist', 'middleBase', 'thumbTip', 'indexTip', 'ringTip', 'pinkyTip']) {
    const p = hand[key];
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) return null;
  }
  const size = handSize(hand);
  if (!(size > 1e-4)) return null;
  const m = { size };
  for (const g of [GESTURE.WALK, GESTURE.TURN_RIGHT, GESTURE.TURN_LEFT]) {
    m[g] = distance(hand.thumbTip, hand[FINGER_OF[g]]) / size;
  }
  return m;
}

/**
 * Choose at most ONE candidate gesture for a hand.
 * - Only pinches below the press threshold are candidates.
 * - The tightest pinch wins (ring and pinky often move together).
 * - If two are within `tieMargin`, the earlier entry in `priority` wins.
 */
export function pickCandidate(measures, press, tieMargin, priority) {
  let best = GESTURE.NONE;
  let bestD = Infinity;
  for (const g of priority) {
    const d = measures[g];
    if (d < press && d < bestD - tieMargin) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

/**
 * Per-hand state machine with hysteresis and debounce:
 *   idle --(candidate below `press` for `dwell` s)--> active
 *   active --(its own distance rises above `release`)--> idle (instantly)
 * While active, other pinches are ignored, so one hand can never produce two
 * gestures at once and a gesture cannot flicker into another mid-pinch.
 */
export class HandGestureDetector {
  constructor(options = {}) {
    this.dwell = options.dwell ?? 0.08;
    this.tieMargin = options.tieMargin ?? 0.03;
    this.priority = options.priority ?? [GESTURE.WALK, GESTURE.TURN_RIGHT, GESTURE.TURN_LEFT];
    this.reset();
  }

  reset() {
    this.active = GESTURE.NONE;
    this.candidate = GESTURE.NONE;
    this.candidateTime = 0;
    this.measures = null;
  }

  update(hand, dt, thresholds) {
    const { press, release } = thresholds;
    const m = measurePinches(hand);
    if (!m) {
      // Hand lost / left the camera: stop everything immediately.
      this.reset();
      return GESTURE.NONE;
    }
    this.measures = m;

    if (this.active !== GESTURE.NONE) {
      if (m[this.active] < release) return this.active;
      // Released: stop now. A new gesture must pass the press threshold again.
      this.active = GESTURE.NONE;
      this.candidate = GESTURE.NONE;
      this.candidateTime = 0;
      return GESTURE.NONE;
    }

    const cand = pickCandidate(m, press, this.tieMargin, this.priority);
    if (cand === GESTURE.NONE) {
      this.candidate = GESTURE.NONE;
      this.candidateTime = 0;
      return GESTURE.NONE;
    }
    if (cand !== this.candidate) {
      this.candidate = cand;
      this.candidateTime = 0;
    }
    this.candidateTime += dt;
    if (this.candidateTime >= this.dwell) {
      this.active = cand;
      return this.active;
    }
    return GESTURE.NONE;
  }
}

/**
 * Combine both hands into one movement intent.
 * - Either hand can walk.
 * - Turns add up; opposite turns cancel (prevents accidental spinning).
 * - Walking with one hand while turning with the other is allowed.
 */
export function combineHands(perHand) {
  let walk = false;
  let turn = 0;
  for (const g of Object.values(perHand)) {
    if (g === GESTURE.WALK) walk = true;
    else if (g === GESTURE.TURN_RIGHT) turn += 1;
    else if (g === GESTURE.TURN_LEFT) turn -= 1;
  }
  return { walk, turn: Math.sign(turn) };
}

/** Two-hand engine used by both desktop (MediaPipe) and VR (WebXR). */
export class GestureEngine {
  constructor(config) {
    this.config = config;
    const opts = { dwell: config.dwell, tieMargin: config.tieMargin, priority: config.priority };
    this.detectors = { left: new HandGestureDetector(opts), right: new HandGestureDetector(opts) };
    this.source = null;
    this.result = this._empty();
  }

  _empty() {
    return {
      walk: false,
      turn: 0,
      perHand: { left: GESTURE.NONE, right: GESTURE.NONE },
      tracked: { left: false, right: false },
      measures: { left: null, right: null },
    };
  }

  reset() {
    this.detectors.left.reset();
    this.detectors.right.reset();
    this.result = this._empty();
  }

  /**
   * @param {{left: object, right: object}} hands
   * @param {number} dt seconds
   * @param {'xr'|'desktop'} source selects thresholds
   */
  update(hands, dt, source) {
    if (source !== this.source) {
      this.reset();
      this.source = source;
    }
    const thresholds = this.config[source] ?? this.config.xr;
    const r = this.result;
    for (const side of ['left', 'right']) {
      const hand = hands?.[side];
      r.perHand[side] = this.detectors[side].update(hand, dt, thresholds);
      r.tracked[side] = !!(hand && hand.tracked && this.detectors[side].measures);
      r.measures[side] = this.detectors[side].measures;
    }
    const c = combineHands(r.perHand);
    r.walk = c.walk;
    r.turn = c.turn;
    return r;
  }
}

/** Convenience: a single label describing the combined state. */
export function describeIntent(result) {
  if (result.walk && result.turn > 0) return 'walk + turn right';
  if (result.walk && result.turn < 0) return 'walk + turn left';
  if (result.walk) return 'walk';
  if (result.turn > 0) return 'turn right';
  if (result.turn < 0) return 'turn left';
  return 'none';
}

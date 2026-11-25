// Desktop hand tracking with the webcam + MediaPipe Hand Landmarker.
// MediaPipe is loaded lazily (only after the user presses Start Camera), so
// Quest 3 never downloads it.
//
// Output uses the same format as the WebXR tracker, built from MediaPipe
// *world* landmarks (metres, hand-centred), so the shared gesture engine and
// its hand-size normalisation behave the same way in both modes.

import { CONFIG } from './config.js';

// MediaPipe landmark indices
const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_TIP: 8, MIDDLE_MCP: 9, RING_TIP: 16, PINKY_TIP: 20 };
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const TIP_FOR_GESTURE = { walk: LM.INDEX_TIP, turnLeft: LM.RING_TIP, turnRight: LM.PINKY_TIP };

function emptyHand() {
  return {
    tracked: false,
    wrist: [0, 0, 0], middleBase: [0, 0, 0],
    thumbTip: [0, 0, 0], indexTip: [0, 0, 0], ringTip: [0, 0, 0], pinkyTip: [0, 0, 0],
  };
}

export class DesktopHandTracker {
  constructor({ video, overlay }) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.hands = { left: emptyHand(), right: emptyHand() };
    this.landmarks = { left: null, right: null }; // normalised image landmarks for drawing
    this.running = false;
    this.starting = false;
    this.landmarker = null;
    this.stream = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.delegate = null;
    this.status = 'Camera off';
  }

  async _createLandmarker() {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks(CONFIG.mediapipe.wasm);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: CONFIG.mediapipe.model, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('[desktop-hands] GPU delegate unavailable, using CPU.', err);
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }
  }

  /** Start webcam + model. Throws a user-readable Error on failure. */
  async start() {
    if (this.running || this.starting) return;
    this.starting = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not available. Use HTTPS (or localhost) in a modern browser.');
      }
      this.status = 'Requesting camera…';
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          throw new Error('Camera permission was denied. Allow camera access in the browser and try again.');
        }
        if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
          throw new Error('No webcam found.');
        }
        throw new Error(`Could not start the camera (${err.name || err.message}).`);
      }
      this.video.srcObject = this.stream;
      await this.video.play();

      if (!this.landmarker) {
        this.status = 'Loading hand model…';
        try {
          await this._createLandmarker();
        } catch (err) {
          this._stopStream();
          throw new Error(`Could not load MediaPipe Hand Landmarker (${err.message || err}).`);
        }
      }
      this.overlay.width = this.video.videoWidth || 640;
      this.overlay.height = this.video.videoHeight || 480;
      this.lastVideoTime = -1;
      this.running = true;
      this.status = `Tracking (${this.delegate})`;
    } finally {
      this.starting = false;
    }
  }

  _stopStream() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  stop() {
    this.running = false;
    this._stopStream();
    this.hands.left.tracked = false;
    this.hands.right.tracked = false;
    this.landmarks.left = this.landmarks.right = null;
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.status = 'Camera off';
  }

  dispose() {
    this.stop();
    if (this.landmarker) this.landmarker.close();
    this.landmarker = null;
  }

  /** Run detection on the newest video frame. Call once per render frame. */
  update(nowMs) {
    if (!this.running || !this.landmarker) return false;
    if (this.video.readyState < 2) return false;
    if (this.video.currentTime === this.lastVideoTime) return false; // no new frame
    this.lastVideoTime = this.video.currentTime;

    const ts = Math.max(nowMs, this.lastTimestamp + 1); // must be strictly increasing
    this.lastTimestamp = ts;
    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, ts);
    } catch (err) {
      console.warn('[desktop-hands] detection failed', err);
      return false;
    }

    this.hands.left.tracked = false;
    this.hands.right.tracked = false;
    this.landmarks.left = this.landmarks.right = null;
    const handedness = result.handedness ?? result.handednesses ?? [];
    const world = result.worldLandmarks ?? [];
    for (let i = 0; i < (result.landmarks?.length ?? 0); i++) {
      const label = handedness[i]?.[0]?.categoryName;
      // MediaPipe labels assume a mirrored (selfie) image; webcam frames are
      // not mirrored, so swap to get the user's real hand.
      let side = label === 'Left' ? 'right' : label === 'Right' ? 'left' : null;
      if (!side) continue;
      if (this.hands[side].tracked) side = side === 'left' ? 'right' : 'left'; // two of the same label
      if (this.hands[side].tracked) continue;
      const w = world[i];
      if (!w) continue;
      const h = this.hands[side];
      const set = (target, p) => { target[0] = p.x; target[1] = p.y; target[2] = p.z; };
      set(h.wrist, w[LM.WRIST]);
      set(h.middleBase, w[LM.MIDDLE_MCP]);
      set(h.thumbTip, w[LM.THUMB_TIP]);
      set(h.indexTip, w[LM.INDEX_TIP]);
      set(h.ringTip, w[LM.RING_TIP]);
      set(h.pinkyTip, w[LM.PINKY_TIP]);
      h.tracked = true;
      this.landmarks[side] = result.landmarks[i];
    }
    return true;
  }

  /** Draw the landmark skeleton over the (CSS-mirrored) video. */
  draw(activeGestures) {
    const { ctx, overlay } = this;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!this.running) return;
    const W = overlay.width;
    const H = overlay.height;
    for (const side of ['left', 'right']) {
      const lm = this.landmarks[side];
      if (!lm) continue;
      const color = side === 'left' ? '#7cc8ff' : '#ffb86b';
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lm[a].x * W, lm[a].y * H);
        ctx.lineTo(lm[b].x * W, lm[b].y * H);
      }
      ctx.stroke();
      const activeTip = TIP_FOR_GESTURE[activeGestures?.[side]];
      for (let i = 0; i < lm.length; i++) {
        const isTip = i === LM.THUMB_TIP || i === LM.INDEX_TIP || i === LM.RING_TIP || i === LM.PINKY_TIP;
        const active = activeTip !== undefined && (i === activeTip || i === LM.THUMB_TIP);
        ctx.fillStyle = active ? '#2ee59d' : isTip ? '#ffffff' : color;
        ctx.beginPath();
        ctx.arc(lm[i].x * W, lm[i].y * H, active ? 9 : isTip ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (activeTip !== undefined) {
        ctx.strokeStyle = '#2ee59d';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(lm[LM.THUMB_TIP].x * W, lm[LM.THUMB_TIP].y * H);
        ctx.lineTo(lm[activeTip].x * W, lm[activeTip].y * H);
        ctx.stroke();
      }
    }
  }
}

// Central configuration. All distances are in METRES, all angles in DEGREES
// unless the name says otherwise. One scene unit = one real-world metre.

export const CONFIG = {
  // ---- Scale -------------------------------------------------------------
  // The built-in Courtyard House is authored directly in real metres, so the
  // model is shown 1:1 (modelScale = 1). For a model authored at another
  // scale (e.g. a 1:70 maquette scan where 1 unit = 1 maquette metre), load
  // it with ?model=...&modelScale=70 so it is enlarged back to life size.
  // XR head tracking is NEVER scaled – see README "Scale & transforms".
  scale: {
    ratioLabel: '1:1',
    modelScale: 1,
  },

  // ---- Body / viewpoint ---------------------------------------------------
  referencePersonHeight: 1.70,
  // Used only on desktop and when the headset grants a 'local' (head-origin)
  // reference space instead of 'local-floor'. With 'local-floor' the real
  // head height reported by Quest 3 is used unchanged.
  eyeHeight: 1.60,
  bodyRadius: 0.22,

  // ---- Locomotion ---------------------------------------------------------
  walkSpeed: 1.3,          // m/s – relaxed human walking pace
  backwardSpeedFactor: 0.6, // keyboard only
  turnSpeed: 55,           // deg/s – smooth turn
  rampTime: 0.15,          // s – ease-in on start; stopping is instant

  // Start: on the garden path, in front of the house, facing north (-Z).
  start: { x: 0, z: 14, yaw: 0 },

  // ---- Gestures -----------------------------------------------------------
  // Pinch distances are divided by hand size (wrist -> middle-finger knuckle)
  // so the same thresholds work for small and large hands.
  gestures: {
    xr:      { press: 0.25, release: 0.36 }, // Quest 3 joint positions
    desktop: { press: 0.32, release: 0.45 }, // MediaPipe world landmarks (noisier depth)
    dwell: 0.08,      // s a pinch must be held before it activates (debounce)
    tieMargin: 0.03,  // if two pinches are this close, priority decides
    priority: ['walk', 'turnRight', 'turnLeft'],
  },

  // ---- Interaction --------------------------------------------------------
  doorTriggerDistance: 1.9,
  doorOpenTime: 0.7,
  poke: { radius: 0.055, rearm: 0.10 }, // fingertip "touch" for switches in VR
  labelFadeStart: 7,
  labelFadeEnd: 4,

  // ---- Libraries (pinned) -------------------------------------------------
  mediapipe: {
    wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    model: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
};

export const DEG = Math.PI / 180;

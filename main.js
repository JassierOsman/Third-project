// App entry: scene, render loop, input routing (VR hands / webcam hands /
// keyboard + mouse), interactions and UI.

import * as THREE from 'three';
import { CONFIG, DEG } from './config.js';
import { GestureEngine, GESTURE, describeIntent } from './gestures.js';
import { CollisionWorld } from './collision.js';
import { Locomotion } from './locomotion.js';
import { XRManager } from './xr-manager.js';
import { XRHandTracker } from './hand-tracking.js';
import { DesktopHandTracker } from './desktop-hands.js';
import { CourtyardHouseSite } from './site.js';
import { VRStatusPanel, MiniMap, intentKey } from './hud.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function toast(message, kind = 'info', ms = 4500) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
}

// ---------------------------------------------------------------------------
// Renderer, scene, player rig
// ---------------------------------------------------------------------------

const container = $('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 250);
camera.rotation.order = 'YXZ';

// rig (locomotion) -> xrOffset (reference-space fallback) -> camera (head)
const rig = new THREE.Group();
rig.name = 'player-rig';
const xrOffset = new THREE.Group();
xrOffset.name = 'tracking-space';
rig.add(xrOffset);
xrOffset.add(camera);
scene.add(rig);

let desktopPitch = 0;
function resetDesktopCamera() {
  camera.position.set(0, CONFIG.eyeHeight, 0);
  camera.rotation.set(desktopPitch, 0, 0);
}
resetDesktopCamera();

const collision = new CollisionWorld();
const site = new CourtyardHouseSite(scene, collision);
const locomotion = new Locomotion({ rig, collision });
const gestures = new GestureEngine(CONFIG.gestures);
const xrHands = new XRHandTracker(scene);
const vrPanel = new VRStatusPanel(scene);
const desktopHands = new DesktopHandTracker({ video: $('cam-video'), overlay: $('cam-overlay') });

// ---------------------------------------------------------------------------
// Head pose (world space) – the single source of truth for direction/rotation
// ---------------------------------------------------------------------------

const head = { x: 0, y: CONFIG.eyeHeight, z: 0, yaw: 0 };
const _hm = new THREE.Matrix4();
const _hp = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _hs = new THREE.Vector3();
const _hf = new THREE.Vector3();

function computeHead(viewerPose) {
  rig.updateMatrixWorld(true);
  if (viewerPose) {
    // Real Quest 3 head pose (metres, in tracking space) -> world. Unscaled.
    _hm.fromArray(viewerPose.transform.matrix).premultiply(xrOffset.matrixWorld);
  } else {
    _hm.copy(camera.matrixWorld);
  }
  _hm.decompose(_hp, _hq, _hs);
  head.x = _hp.x;
  head.y = _hp.y;
  head.z = _hp.z;
  _hf.set(0, 0, -1).applyQuaternion(_hq);
  // Horizontal facing only: vertical head motion never affects walking.
  if (Math.hypot(_hf.x, _hf.z) > 0.15) head.yaw = Math.atan2(-_hf.x, -_hf.z);
}

function placeAtStart() {
  computeHead(xrManager.isPresenting ? lastViewerPose : null);
  locomotion.teleportHeadTo(CONFIG.start.x, CONFIG.start.z, CONFIG.start.yaw * DEG, head);
  if (!xrManager.isPresenting) {
    desktopPitch = 0;
    resetDesktopCamera();
  }
  computeHead(xrManager.isPresenting ? lastViewerPose : null);
}

// ---------------------------------------------------------------------------
// XR session
// ---------------------------------------------------------------------------

let lastViewerPose = null;
let xrStartTime = 0;
let lastXRHead = null;
const btnVR = $('btn-vr');

const xrManager = new XRManager(renderer, {
  xrOffset,
  eyeHeight: CONFIG.eyeHeight,
  onStart: () => {
    // Desktop webcam tracking must not compete with WebXR hands.
    if (desktopHands.running || desktopHands.starting) stopCamera(true);
    gestures.reset();
    locomotion.stop();
    xrStartTime = performance.now();
    vrPanel.setVisible(true);
    btnVR.textContent = 'Exit VR';
    document.body.classList.add('in-vr');
    if (xrManager.handTrackingGranted === false) {
      toast('Hand tracking was not granted. Enable it in Quest Settings › Movement tracking.', 'warn', 8000);
    }
  },
  onEnd: () => {
    lastViewerPose = null;
    vrPanel.setVisible(false);
    xrHands.hide();
    gestures.reset();
    locomotion.stop();
    btnVR.textContent = 'Enter VR';
    document.body.classList.remove('in-vr');
    // Continue on desktop from where the VR user was standing.
    desktopPitch = 0;
    resetDesktopCamera();
    computeHead(null);
    if (lastXRHead) locomotion.teleportHeadTo(lastXRHead.x, lastXRHead.z, lastXRHead.yaw, head);
    onResize();
    toast('Left VR – back in desktop mode.');
  },
});

btnVR.addEventListener('click', async () => {
  if (xrManager.isPresenting) {
    await xrManager.exit();
    return;
  }
  btnVR.disabled = true;
  try {
    await xrManager.enter();
  } catch (err) {
    console.warn('[xr] could not start session', err);
    toast(`Could not start VR: ${err.message || err}`, 'error', 7000);
  } finally {
    btnVR.disabled = !xrManager.supported;
  }
});

xrManager.checkSupport().then((ok) => {
  btnVR.disabled = !ok;
  btnVR.textContent = ok ? 'Enter VR' : 'VR not available';
  btnVR.title = ok ? 'Start immersive VR (Meta Quest Browser)' : xrManager.unsupportedReason;
  if (!ok) $('vr-note').textContent = xrManager.unsupportedReason;
  else $('vr-note').textContent = 'Headset detected – press Enter VR, then put the controllers down.';
});

// ---------------------------------------------------------------------------
// Desktop camera (MediaPipe)
// ---------------------------------------------------------------------------

const btnCamStart = $('btn-cam-start');
const btnCamStop = $('btn-cam-stop');
const camPanel = $('cam-panel');
const dlgCamera = $('dlg-camera');

function setCamButtons() {
  const on = desktopHands.running || desktopHands.starting;
  btnCamStart.disabled = on || xrManager.isPresenting;
  btnCamStop.disabled = !on;
  camPanel.classList.toggle('hidden', !on);
}

async function startCamera() {
  setCamButtons();
  camPanel.classList.remove('hidden');
  btnCamStart.disabled = true;
  $('cam-status').textContent = 'Starting camera…';
  try {
    const p = desktopHands.start();
    const statusTimer = setInterval(() => { $('cam-status').textContent = desktopHands.status; }, 200);
    await p.finally(() => clearInterval(statusTimer));
    if (xrManager.isPresenting) {
      stopCamera(true);
      return;
    }
    gestures.reset();
    toast('Camera on – pinch thumb + index to walk.', 'ok');
  } catch (err) {
    console.warn('[camera]', err);
    desktopHands.stop();
    toast(err.message || String(err), 'error', 8000);
  }
  setCamButtons();
}

function stopCamera(silent = false) {
  desktopHands.stop();
  gestures.reset();
  setCamButtons();
  if (!silent) toast('Camera stopped.');
}

btnCamStart.addEventListener('click', () => {
  // Explicit consent before the browser permission prompt.
  if (typeof dlgCamera.showModal === 'function') dlgCamera.showModal();
  else if (window.confirm('Start the webcam for hand tracking? Video is processed locally and never uploaded.')) startCamera();
});
$('btn-cam-allow').addEventListener('click', () => {
  dlgCamera.close();
  startCamera();
});
$('btn-cam-cancel').addEventListener('click', () => dlgCamera.close());
btnCamStop.addEventListener('click', () => stopCamera());

// ---------------------------------------------------------------------------
// Other buttons, help, debug panel, minimap
// ---------------------------------------------------------------------------

$('btn-reset').addEventListener('click', () => {
  placeAtStart();
  toast('Back at the start.');
});

const btnNight = $('btn-night');
function syncNightButton() {
  btnNight.textContent = site.night ? 'Day' : 'Night';
  btnNight.setAttribute('aria-pressed', String(site.night));
}
btnNight.addEventListener('click', () => {
  site.toggleNight();
  syncNightButton();
});

const dlgHelp = $('dlg-help');
$('btn-help').addEventListener('click', () => dlgHelp.showModal?.());
$('btn-help-close').addEventListener('click', () => {
  dlgHelp.close();
  storageSet('courtyard-help-seen', '1');
});
if (!storageGet('courtyard-help-seen') && typeof dlgHelp.showModal === 'function') dlgHelp.showModal();

$('btn-debug-toggle').addEventListener('click', () => {
  const collapsed = $('debug').classList.toggle('collapsed');
  $('btn-debug-toggle').textContent = collapsed ? '+' : '–';
});

const minimap = new MiniMap($('minimap'), site.map, (x, z) => {
  if (xrManager.isPresenting) return;
  if (collision.collides(x, z, CONFIG.bodyRadius)) {
    toast("Can't stand there – pick an open spot.", 'warn', 2500);
    return;
  }
  computeHead(null);
  locomotion.teleportHeadTo(x, z, head.yaw, head);
});

// ---------------------------------------------------------------------------
// Keyboard + mouse (desktop fallback / convenience)
// ---------------------------------------------------------------------------

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (k === 'r' && !e.repeat) placeAtStart();
  if (k === 'n' && !e.repeat) { site.toggleNight(); syncNightButton(); }
  keys.add(k);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function keyboardIntent() {
  let move = 0, turn = 0;
  if (keys.has('w') || keys.has('arrowup')) move += 1;
  if (keys.has('s') || keys.has('arrowdown')) move -= 1;
  if (keys.has('d') || keys.has('arrowright')) turn += 1;
  if (keys.has('a') || keys.has('arrowleft')) turn -= 1;
  return { move, turn };
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let drag = null;

function pickInteractive(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const items = site.getInteractives();
  const hits = raycaster.intersectObjects(items.map((it) => it.mesh), false);
  if (!hits.length || hits[0].distance > 6) return null;
  return site.findInteractive(hits[0].object);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (xrManager.isPresenting) return;
  drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, id: e.pointerId };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (xrManager.isPresenting) return;
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) drag.moved = true;
    if (drag.moved) {
      computeHead(null);
      locomotion.rotateAroundPoint(-dx * 0.0042, head.x, head.z);
      desktopPitch = THREE.MathUtils.clamp(desktopPitch - dy * 0.0035, -1.2, 1.2);
      camera.rotation.x = desktopPitch;
    }
    return;
  }
  renderer.domElement.style.cursor = pickInteractive(e.clientX, e.clientY) ? 'pointer' : 'grab';
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const wasClick = !drag.moved;
  drag = null;
  if (wasClick) {
    const item = pickInteractive(e.clientX, e.clientY);
    if (item) {
      site.activate(item);
      syncNightButton();
    }
  }
});
renderer.domElement.addEventListener('pointercancel', () => { drag = null; });

// ---------------------------------------------------------------------------
// Fingertip "touch" for switches in VR
// ---------------------------------------------------------------------------

const pokeLock = { left: null, right: null };
function updatePoke() {
  const items = site.getInteractives();
  for (const side of ['left', 'right']) {
    if (!xrHands.hands[side].tracked) {
      pokeLock[side] = null;
      continue;
    }
    const tip = xrHands.indexTipWorld[side];
    if (pokeLock[side]) {
      if (tip.distanceTo(pokeLock[side].worldPos) > CONFIG.poke.rearm) pokeLock[side] = null;
      continue;
    }
    for (const it of items) {
      if (tip.distanceTo(it.worldPos) < CONFIG.poke.radius) {
        site.activate(it);
        syncNightButton();
        pokeLock[side] = it;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Optional custom glTF model: ?model=assets/models/house.glb&modelScale=1
// ---------------------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
let scaleLabel = CONFIG.scale.ratioLabel;
if (params.get('model')) {
  const modelScale = parseFloat(params.get('modelScale')) || CONFIG.scale.modelScale;
  const url = new URL(params.get('model'), document.baseURI).href;
  import('three/addons/loaders/GLTFLoader.js')
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url))
    .then((gltf) => {
      gltf.scene.scale.setScalar(modelScale);
      site.useCustomModel(gltf.scene);
      minimap.refresh();
      scaleLabel = modelScale === 1 ? '1:1 (custom model)' : `model ×${modelScale} → 1:1 view`;
      toast(`Loaded model: ${params.get('model')}`, 'ok');
    })
    .catch((err) => {
      console.warn('[model] load failed', err);
      toast(`Could not load model "${params.get('model')}" – showing the Courtyard House instead.`, 'error', 8000);
    });
}

// ---------------------------------------------------------------------------
// Debug panel + gesture guide
// ---------------------------------------------------------------------------

const dbg = {
  xr: $('d-xr'), hands: $('d-hands'), activeHand: $('d-active-hand'), pinch: $('d-pinch'),
  speed: $('d-speed'), turn: $('d-turn'), scale: $('d-scale'), fps: $('d-fps'),
  pos: $('d-pos'), ratios: $('d-ratios'),
};
const guideCards = [...document.querySelectorAll('.g-card')];
const camStatus = $('cam-status');

function fmtRatios(m) {
  if (!m) return '—';
  return `i ${m.walk.toFixed(2)} · r ${m.turnLeft.toFixed(2)} · p ${m.turnRight.toFixed(2)}`;
}

function updateDebug(g, source, fps) {
  if (xrManager.isPresenting) {
    dbg.xr.textContent = `immersive-vr (${xrManager.referenceSpaceType})`;
    const s = xrManager.inputSummary();
    const granted = xrManager.handTrackingGranted === false ? ' · NOT granted' : '';
    dbg.hands.textContent = `WebXR: ${s.hands} hand(s), ${s.controllers} controller(s)${granted}`;
  } else {
    dbg.xr.textContent = xrManager.supported ? 'ready (not presenting)' : 'unavailable';
    dbg.hands.textContent = desktopHands.running
      ? `Webcam: ${(g.tracked.left ? 1 : 0) + (g.tracked.right ? 1 : 0)} hand(s)`
      : desktopHands.starting ? 'Webcam: starting…' : 'Webcam off (keyboard/mouse)';
  }
  const active = ['left', 'right'].filter((s) => g.perHand[s] !== GESTURE.NONE);
  const tracked = ['left', 'right'].filter((s) => g.tracked[s]);
  dbg.activeHand.textContent = active.length ? active.join(' + ') : tracked.length ? `tracked: ${tracked.join(' + ')}` : 'none';
  dbg.pinch.textContent = active.length
    ? active.map((s) => `${s}: ${g.perHand[s]}`).join(', ')
    : 'none';
  dbg.speed.textContent = `${locomotion.speed.toFixed(2)} m/s${locomotion.blocked ? ' (blocked)' : ''}`;
  dbg.turn.textContent = `${locomotion.turnRate.toFixed(0)} °/s`;
  dbg.scale.textContent = scaleLabel;
  dbg.fps.textContent = fps.toFixed(0);
  dbg.pos.textContent = `x ${head.x.toFixed(2)} · z ${head.z.toFixed(2)} · eye ${head.y.toFixed(2)} m`;
  dbg.ratios.textContent = `L ${fmtRatios(g.measures.left)} | R ${fmtRatios(g.measures.right)}`;
  if (desktopHands.running) camStatus.textContent = `${desktopHands.status} · ${describeIntent(g)}`;
}

function updateGuide(walk, turn) {
  for (const card of guideCards) {
    const gname = card.dataset.gesture;
    const on = (gname === 'walk' && walk) || (gname === 'turnLeft' && turn < 0) || (gname === 'turnRight' && turn > 0);
    card.classList.toggle('active', on);
  }
}

// ---------------------------------------------------------------------------
// Render loop (desktop + XR share renderer.setAnimationLoop)
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
let fpsFrames = 0, fpsTime = 0, fps = 0, uiTimer = 0, mapTimer = 0;

function frameXR(dt, frame) {
  const refSpace = renderer.xr.getReferenceSpace();
  const viewerPose = frame.getViewerPose(refSpace);
  if (viewerPose) lastViewerPose = viewerPose;

  xrHands.update(frame, refSpace);
  computeHead(lastViewerPose);

  const g = gestures.update(xrHands.hands, dt, 'xr');
  locomotion.update(dt, { move: g.walk ? 1 : 0, turn: g.turn }, head);

  computeHead(lastViewerPose);
  lastXRHead = { x: head.x, z: head.z, yaw: head.yaw };
  xrHands.updateVisuals(xrOffset.matrixWorld, g.perHand);
  updatePoke();

  // VR status indicator
  const anyHand = g.tracked.left || g.tracked.right;
  const s = xrManager.inputSummary();
  let warning = null, hint = null;
  if (xrManager.handTrackingGranted === false) {
    warning = 'Hand tracking unavailable';
    hint = 'Quest Settings › Movement tracking › Hand tracking';
  } else if (!anyHand && s.controllers > 0) {
    warning = 'Put the controllers down';
    hint = 'Hands are tracked when controllers are idle';
  } else if (!anyHand && performance.now() - xrStartTime > 4000) {
    warning = 'No hands detected';
    hint = 'Hold your hands in front of the headset';
  }
  vrPanel.update(dt, head, {
    intent: intentKey(g.walk, g.turn), left: g.tracked.left, right: g.tracked.right, warning, hint,
  });
  return g;
}

function frameDesktop(dt) {
  if (desktopHands.update(performance.now())) {
    // landmarks refreshed for this video frame
  }
  computeHead(null);
  const g = gestures.update(desktopHands.hands, dt, 'desktop');
  const kb = keyboardIntent();
  const intent = {
    move: g.walk ? 1 : kb.move,
    turn: g.turn !== 0 ? g.turn : kb.turn,
  };
  locomotion.update(dt, intent, head);
  computeHead(null);
  desktopHands.draw(g.perHand);
  return g;
}

renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime;
    fpsFrames = 0;
    fpsTime = 0;
  }

  const g = frame && xrManager.isPresenting ? frameXR(dt, frame) : frameDesktop(dt);

  site.update(dt, head);

  uiTimer += dt;
  if (uiTimer > 0.2) {
    uiTimer = 0;
    updateDebug(g, xrManager.isPresenting ? 'xr' : 'desktop', fps);
  }
  if (!xrManager.isPresenting) {
    updateGuide(g.walk || keyboardIntent().move > 0, g.turn || keyboardIntent().turn);
    mapTimer += dt;
    if (mapTimer > 1 / 20) {
      mapTimer = 0;
      minimap.draw(head);
    }
  }

  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// Resize + lifecycle
// ---------------------------------------------------------------------------

function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

window.addEventListener('pagehide', () => {
  desktopHands.dispose();
  if (xrManager.isPresenting) xrManager.exit();
});

placeAtStart();
syncNightButton();
setCamButtons();
document.body.classList.add('ready');

// Expose a tiny handle for console debugging / automated smoke tests.
window.__courtyard = { scene, rig, camera, site, locomotion, gestures, collision, head, placeAtStart };

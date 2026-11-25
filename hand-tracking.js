// Quest 3 native hand tracking via the WebXR Hand Input API.
// Reads the 25 joint poses of each hand every XR frame, converts them to the
// shared gesture-engine format, draws the joints, and exposes the index
// fingertips in world space for touching switches.

import * as THREE from 'three';

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

const J = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));
const N = JOINT_NAMES.length;

const TIP_FOR_GESTURE = {
  walk: J['index-finger-tip'],
  turnLeft: J['ring-finger-tip'],
  turnRight: J['pinky-finger-tip'],
};

const COLOR_JOINT = new THREE.Color(0xe8eef5);
const COLOR_TIP = new THREE.Color(0x7cc8ff);
const COLOR_ACTIVE = new THREE.Color(0x2ee59d);
const TIP_INDICES = [J['thumb-tip'], J['index-finger-tip'], J['ring-finger-tip'], J['pinky-finger-tip']];

function emptyHand() {
  return {
    tracked: false,
    wrist: [0, 0, 0], middleBase: [0, 0, 0],
    thumbTip: [0, 0, 0], indexTip: [0, 0, 0], ringTip: [0, 0, 0], pinkyTip: [0, 0, 0],
  };
}

export class XRHandTracker {
  constructor(scene) {
    this.hands = { left: emptyHand(), right: emptyHand() };
    this.poses = { left: new Float32Array(N * 16), right: new Float32Array(N * 16) };
    this.radii = { left: new Float32Array(N), right: new Float32Array(N) };
    this.indexTipWorld = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    this._spaces = new WeakMap(); // XRHand -> XRJointSpace[] in JOINT_NAMES order
    this._tmpPose = new Float32Array(16);

    // One instanced mesh draws all 50 joints in a single draw call.
    const geo = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222831 });
    this.mesh = new THREE.InstancedMesh(geo, mat, N * 2);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'xr-hand-joints';
    for (let i = 0; i < N * 2; i++) this.mesh.setColorAt(i, COLOR_JOINT);
    scene.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._v = new THREE.Vector3();
  }

  _jointSpaces(hand) {
    let spaces = this._spaces.get(hand);
    if (!spaces) {
      spaces = JOINT_NAMES.map((name) => hand.get(name));
      this._spaces.set(hand, spaces);
    }
    return spaces;
  }

  _readPoses(frame, hand, refSpace, out, radii) {
    const spaces = this._jointSpaces(hand);
    if (spaces.some((s) => !s)) return false;
    if (typeof frame.fillPoses === 'function') {
      if (!frame.fillPoses(spaces, refSpace, out)) return false;
      if (typeof frame.fillJointRadii === 'function') frame.fillJointRadii(spaces, radii);
      return true;
    }
    for (let i = 0; i < N; i++) {
      const pose = frame.getJointPose(spaces[i], refSpace);
      if (!pose) return false;
      out.set(pose.transform.matrix, i * 16);
      radii[i] = pose.radius ?? 0.008;
    }
    return true;
  }

  /** Read joint data for this XR frame (positions in reference space). */
  update(frame, refSpace) {
    this.hands.left.tracked = false;
    this.hands.right.tracked = false;
    if (!frame || !refSpace) return;

    for (const source of frame.session.inputSources) {
      if (!source.hand) continue;
      const side = source.handedness;
      if (side !== 'left' && side !== 'right') continue;
      const poses = this.poses[side];
      if (!this._readPoses(frame, source.hand, refSpace, poses, this.radii[side])) continue;

      const h = this.hands[side];
      const copy = (target, idx) => {
        target[0] = poses[idx * 16 + 12];
        target[1] = poses[idx * 16 + 13];
        target[2] = poses[idx * 16 + 14];
      };
      copy(h.wrist, J.wrist);
      copy(h.middleBase, J['middle-finger-phalanx-proximal']);
      copy(h.thumbTip, J['thumb-tip']);
      copy(h.indexTip, J['index-finger-tip']);
      copy(h.ringTip, J['ring-finger-tip']);
      copy(h.pinkyTip, J['pinky-finger-tip']);
      h.tracked = true;
    }
  }

  /**
   * Draw the joints in world space and update fingertip positions.
   * @param {THREE.Matrix4} spaceToWorld matrixWorld of the tracking-space group
   * @param {{left:string, right:string}} activeGestures for tip highlighting
   */
  updateVisuals(spaceToWorld, activeGestures) {
    const any = this.hands.left.tracked || this.hands.right.tracked;
    this.mesh.visible = any;
    if (!any) return;
    let base = 0;
    for (const side of ['left', 'right']) {
      const h = this.hands[side];
      const poses = this.poses[side];
      const radii = this.radii[side];
      const activeTip = TIP_FOR_GESTURE[activeGestures?.[side]];
      for (let i = 0; i < N; i++) {
        if (!h.tracked) {
          this.mesh.setMatrixAt(base + i, this._zero);
          continue;
        }
        this._m.fromArray(poses, i * 16).premultiply(spaceToWorld);
        const r = Math.max(0.004, (radii[i] || 0.008) * 0.85);
        this._v.setFromMatrixPosition(this._m);
        this._m.makeScale(r, r, r).setPosition(this._v);
        this.mesh.setMatrixAt(base + i, this._m);
        if (i === J['index-finger-tip']) this.indexTipWorld[side].copy(this._v);
      }
      if (h.tracked) {
        for (const t of TIP_INDICES) {
          const active = activeTip !== undefined && (t === activeTip || t === J['thumb-tip']);
          this.mesh.setColorAt(base + t, active ? COLOR_ACTIVE : COLOR_TIP);
        }
      }
      base += N;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  hide() {
    this.hands.left.tracked = false;
    this.hands.right.tracked = false;
    this.mesh.visible = false;
  }
}

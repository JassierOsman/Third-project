// WebXR session lifecycle: support check, Enter/Exit VR, reference-space
// fallback, and clean hand-back to desktop mode.

export class XRManager {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{ xrOffset: THREE.Object3D, eyeHeight: number,
   *           onStart?: Function, onEnd?: Function }} options
   */
  constructor(renderer, { xrOffset, eyeHeight, onStart, onEnd }) {
    this.renderer = renderer;
    this.xrOffset = xrOffset;
    this.eyeHeight = eyeHeight;
    this.onStart = onStart ?? (() => {});
    this.onEnd = onEnd ?? (() => {});
    this.session = null;
    this.referenceSpaceType = null;
    this.handTrackingGranted = null; // true / false / null (browser can't tell)
    this.supported = false;
    this.unsupportedReason = '';
    this._onSessionEnd = this._onSessionEnd.bind(this);
  }

  async checkSupport() {
    if (!window.isSecureContext) {
      this.unsupportedReason = 'WebXR needs HTTPS (GitHub Pages provides it).';
      return false;
    }
    if (!('xr' in navigator)) {
      this.unsupportedReason = 'This browser has no WebXR. Open the page in Meta Quest Browser.';
      return false;
    }
    try {
      this.supported = await navigator.xr.isSessionSupported('immersive-vr');
    } catch (err) {
      this.supported = false;
    }
    if (!this.supported) this.unsupportedReason = 'No VR headset available here. Open this page in Meta Quest Browser.';
    return this.supported;
  }

  get isPresenting() {
    return !!this.session;
  }

  async enter() {
    if (this.session) return this.session;
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'hand-tracking'],
    });

    // Prefer 'local-floor' (real head height above the floor). If the device
    // refuses it, fall back to 'local' (origin = head at start) and lift the
    // tracking space by the configured eye height so the view isn't at floor level.
    let type = 'local-floor';
    try {
      await session.requestReferenceSpace('local-floor');
    } catch {
      type = 'local';
    }
    this.referenceSpaceType = type;
    this.xrOffset.position.y = type === 'local' ? this.eyeHeight : 0;
    this.xrOffset.updateMatrixWorld(true);

    const features = session.enabledFeatures;
    this.handTrackingGranted = Array.isArray(features) ? features.includes('hand-tracking') : null;

    session.addEventListener('end', this._onSessionEnd);
    this.renderer.xr.setReferenceSpaceType(type);
    try {
      await this.renderer.xr.setSession(session);
    } catch (err) {
      session.removeEventListener('end', this._onSessionEnd);
      this.xrOffset.position.y = 0;
      try { await session.end(); } catch { /* already ended */ }
      throw err;
    }
    this.session = session;
    this.onStart(session);
    return session;
  }

  async exit() {
    if (this.session) await this.session.end();
  }

  _onSessionEnd() {
    if (this.session) this.session.removeEventListener('end', this._onSessionEnd);
    this.session = null;
    this.referenceSpaceType = null;
    this.xrOffset.position.y = 0;
    this.xrOffset.updateMatrixWorld(true);
    this.onEnd();
  }

  /** Quick summary of the current input sources (hands vs controllers). */
  inputSummary() {
    const out = { hands: 0, controllers: 0 };
    if (!this.session) return out;
    for (const src of this.session.inputSources) {
      if (src.hand) out.hands++;
      else if (src.gamepad) out.controllers++;
    }
    return out;
  }
}

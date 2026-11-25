// In-VR status indicator (small, low in the view, lazily follows the head)
// and the desktop minimap.

import * as THREE from 'three';

const LABELS = {
  walk: { text: 'WALKING', icon: '▲', color: '#2ee59d' },
  'walk+left': { text: 'WALK + LEFT', icon: '◀▲', color: '#2ee59d' },
  'walk+right': { text: 'WALK + RIGHT', icon: '▲▶', color: '#2ee59d' },
  left: { text: 'TURN LEFT', icon: '◀', color: '#7cc8ff' },
  right: { text: 'TURN RIGHT', icon: '▶', color: '#7cc8ff' },
  idle: { text: 'READY', icon: '●', color: '#d6dde6' },
};

export function intentKey(walk, turn) {
  if (walk && turn < 0) return 'walk+left';
  if (walk && turn > 0) return 'walk+right';
  if (walk) return 'walk';
  if (turn < 0) return 'left';
  if (turn > 0) return 'right';
  return 'idle';
}

export class VRStatusPanel {
  constructor(scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 144;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26 * 144 / 512), mat);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    this.mesh.name = 'vr-status-panel';
    scene.add(this.mesh);
    this.key = '';
    this.yaw = 0;
    this.placed = false;
  }

  setVisible(v) {
    this.mesh.visible = v;
    if (!v) this.placed = false;
  }

  _draw(state) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(14, 18, 26, 0.78)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(4, 4, W - 8, H - 8, 34);
    else ctx.rect(4, 4, W - 8, H - 8);
    ctx.fill();
    const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

    // hand dots
    const dot = (x, label, on) => {
      ctx.fillStyle = on ? '#2ee59d' : '#5a6372';
      ctx.beginPath();
      ctx.arc(x, 52, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c9d4e0';
      ctx.font = `600 24px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, 98);
    };
    dot(52, 'L', state.left);
    dot(102, 'R', state.right);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (state.warning) {
      ctx.fillStyle = '#ffb86b';
      ctx.font = `700 30px ${font}`;
      ctx.fillText(state.warning, 140, 56, W - 160);
      ctx.fillStyle = '#c9d4e0';
      ctx.font = `500 22px ${font}`;
      ctx.fillText(state.hint ?? '', 140, 98, W - 160);
    } else {
      const L = LABELS[state.intent] ?? LABELS.idle;
      ctx.fillStyle = L.color;
      ctx.font = `800 46px ${font}`;
      ctx.fillText(`${L.icon}  ${L.text}`, 140, 62, W - 160);
      ctx.fillStyle = '#9aa7b6';
      ctx.font = `500 21px ${font}`;
      ctx.fillText('index: walk · ring: left · pinky: right', 140, 106, W - 160);
    }
    this.texture.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @param {{x,y,z,yaw}} head world-space head pose
   * @param {{intent, left, right, warning?, hint?}} state
   */
  update(dt, head, state) {
    const key = `${state.intent}|${state.left}|${state.right}|${state.warning ?? ''}|${state.hint ?? ''}`;
    if (key !== this.key) {
      this.key = key;
      this._draw(state);
    }
    // Lazy follow: sits 0.7 m ahead, 0.36 m below the eyes, tilted up.
    if (!this.placed) {
      this.yaw = head.yaw;
    } else {
      let d = head.yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 3));
    }
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const tx = head.x + fx * 0.7, ty = head.y - 0.36, tz = head.z + fz * 0.7;
    const k = this.placed ? 1 - Math.exp(-dt * 10) : 1;
    this.mesh.position.x += (tx - this.mesh.position.x) * k;
    this.mesh.position.y += (ty - this.mesh.position.y) * k;
    this.mesh.position.z += (tz - this.mesh.position.z) * k;
    this.mesh.rotation.set(-0.45, this.yaw, 0);
    this.placed = true;
  }
}

const ROOM_FILL = {
  floorWood: '#c9a27a',
  floorTile: '#d9d6cf',
  floorStone: '#cdbfa6',
};

export class MiniMap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} siteMap site.map shapes
   * @param {(x:number, z:number) => void} onTeleport
   */
  constructor(canvas, siteMap, onTeleport) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = siteMap;
    this.onTeleport = onTeleport;
    this.bounds = { minX: -12, maxX: 12, minZ: -9, maxZ: 22 };
    this.base = document.createElement('canvas');
    this._resize();
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const { x, z } = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.onTeleport(x, z);
    });
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const cssW = this.canvas.clientWidth || 200;
    const cssH = Math.round(cssW * (this.bounds.maxZ - this.bounds.minZ) / (this.bounds.maxX - this.bounds.minX));
    this.canvas.style.height = `${cssH}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    for (const c of [this.canvas, this.base]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
    }
    this.scale = cssW / (this.bounds.maxX - this.bounds.minX);
    this._drawBase();
  }

  toPx(x, z) {
    return [(x - this.bounds.minX) * this.scale, (z - this.bounds.minZ) * this.scale];
  }

  toWorld(px, py) {
    return { x: px / this.scale + this.bounds.minX, z: py / this.scale + this.bounds.minZ };
  }

  refresh() {
    this._drawBase();
  }

  _drawBase() {
    const ctx = this.base.getContext('2d');
    const s = this.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.fillStyle = '#5f8a46';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const rect = (r, fill) => {
      const [x0, y0] = this.toPx(r.x0, r.z0);
      const [x1, y1] = this.toPx(r.x1, r.z1);
      ctx.fillStyle = fill;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    for (const p of this.map.paths) rect(p, '#b3aa98');
    if (!this.map.custom) {
      for (const r of this.map.rooms) rect(r, ROOM_FILL[r.floor] ?? '#ddd');
      for (const w of this.map.water) rect(w, '#3aa6d6');
      for (const b of this.map.solids) {
        if (b.kind === 'water') continue;
        rect(b, b.kind === 'hedge' ? '#3f7536' : 'rgba(60, 50, 40, 0.45)');
      }
    }
    for (const t of this.map.trees) {
      const [x, y] = this.toPx(t.x, t.z);
      ctx.fillStyle = 'rgba(52, 102, 40, 0.85)';
      ctx.beginPath();
      ctx.arc(x, y, t.r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!this.map.custom) {
      ctx.lineCap = 'square';
      for (const w of this.map.walls) {
        const [x0, y0] = this.toPx(w.x0, w.z0);
        const [x1, y1] = this.toPx(w.x1, w.z1);
        ctx.strokeStyle = w.window ? '#8fd0ff' : w.low ? '#8a7a64' : '#24272c';
        ctx.lineWidth = Math.max(2, 0.22 * s);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ffd59a';
      ctx.lineWidth = 2;
      for (const d of this.map.doors) {
        const [x0, y0] = this.toPx(d.x0, d.z0);
        const [x1, y1] = this.toPx(d.x1, d.z1);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
    // North marker
    ctx.fillStyle = 'rgba(14,18,26,0.7)';
    ctx.fillRect(this.cssW - 24, 6, 18, 20);
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', this.cssW - 15, 16);
  }

  draw(head) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const [x, y] = this.toPx(head.x, head.z);
    // Forward on the map: world (-sin yaw, -cos yaw) -> canvas (dx, dy)
    const a = Math.atan2(-Math.cos(head.yaw), -Math.sin(head.yaw));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(46, 229, 157, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 26, -0.5, 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2ee59d';
    ctx.strokeStyle = '#0e121a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

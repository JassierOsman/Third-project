// "Courtyard House" – a single-storey house around an open courtyard, authored
// in real metres (1 unit = 1 m) and shown at 1:1 scale.
//
// Performance: all static geometry is merged into one mesh per material
// (a few dozen draw calls in total). Only interactive parts (doors, switches,
// lamp shades, labels) stay as separate objects.
//
// Interactions:
//   - Doors swing open automatically when you come close.
//   - Glowing wall switches toggle each room's light (touch with a fingertip in
//     VR, click on desktop).
//   - The glowing orb in the courtyard toggles day / night.
//   - Room name signs fade in as you approach.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function makeMaterials() {
  return {
    wall: lambert(0xf3f0ea),
    wallAccent: lambert(0xd9cbb4),
    roof: lambert(0xe9e5de),
    frame: lambert(0x3b3f45),
    glass: new THREE.MeshBasicMaterial({
      color: 0xbfe3ff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
    }),
    wood: lambert(0xc79b6a),
    woodDark: lambert(0x6e4b30),
    floorWood: lambert(0xb98a5c),
    floorTile: lambert(0xdedad3),
    floorStone: lambert(0xcdbfa6),
    concrete: lambert(0xbdb8b0),
    pathStone: lambert(0xb3aa98),
    grass: lambert(0x7ea85a),
    hedge: lambert(0x3f7536),
    leaf: lambert(0x4f8a3c),
    leafLight: lambert(0x6aa84f),
    trunk: lambert(0x6b4a2f),
    fabricBlue: lambert(0x56789a),
    fabricRust: lambert(0xc4683f),
    rug: lambert(0xa8513a),
    rugSoft: lambert(0xd8c7a8),
    white: lambert(0xf7f7f5),
    cabinet: lambert(0x45616d),
    counter: lambert(0xf0efeb),
    metal: lambert(0xa3abb3),
    dark: lambert(0x2c2f33),
    pot: lambert(0xb8643f),
    water: lambert(0x3aa6d6, { emissive: 0x0b3550 }),
    poleRed: lambert(0xd8453b),
    poleWhite: lambert(0xf4f4f4),
    person: lambert(0x5a77a8),
    arrow: lambert(0xffffff, { emissive: 0x333333 }),
    book1: lambert(0x8e3b46),
    book2: lambert(0x2f5d7c),
    book3: lambert(0xd9a441),
  };
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function trs(x, y, z, ry = 0, rx = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m4.compose(_p, _q, _s);
}

/** Collects static geometry per material and merges it into single meshes. */
class Batcher {
  constructor() {
    this.buckets = new Map();
  }

  add(geometry, material, matrix) {
    let g = geometry;
    if (g.index) {
      g = geometry.toNonIndexed();
      geometry.dispose();
    }
    g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    let list = this.buckets.get(material);
    if (!list) {
      list = [];
      this.buckets.set(material, list);
    }
    list.push(g);
  }

  build(parent, name) {
    let i = 0;
    for (const [material, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}-batch-${i++}`;
      mesh.matrixAutoUpdate = false;
      if (material.transparent) mesh.renderOrder = 2;
      parent.add(mesh);
    }
    this.buckets.clear();
  }
}

/** Renders lines of text to a canvas texture. Returns { texture, aspect }. */
function textTexture(lines, opts = {}) {
  const {
    width = 512, padding = 26, radius = 26,
    bg = 'rgba(18, 22, 30, 0.86)', align = 'center',
  } = opts;
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const rows = lines.map((l) => (typeof l === 'string' ? { text: l } : l));
  const heights = rows.map((r) => (r.size ?? 40) * 1.3);
  const height = Math.ceil(padding * 2 + heights.reduce((a, b) => a + b, 0));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, width, height, radius);
    else ctx.rect(0, 0, width, height);
    ctx.fill();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  let y = padding;
  rows.forEach((r, i) => {
    const size = r.size ?? 40;
    ctx.font = `${r.weight ?? 600} ${size}px ${font}`;
    ctx.fillStyle = r.color ?? '#ffffff';
    const x = align === 'center' ? width / 2 : padding;
    ctx.fillText(r.text, x, y + heights[i] / 2, width - padding * 2);
    y += heights[i];
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: width / height };
}

function makeLabel(lines, worldWidth, opts) {
  const { texture, aspect } = textTexture(lines, opts);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, worldWidth / aspect, 1);
  sprite.renderOrder = 5;
  return sprite;
}

// Deterministic pseudo-random for repeatable decoration.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------

const ROOMS = [
  { id: 'living', name: 'Living Room', x0: -8, x1: -3, z0: -6, z1: 6, floor: 'floorWood', light: [-5.5, 0], labelZ: 0 },
  { id: 'entry', name: 'Entrance Hall', x0: -3, x1: 3, z0: 2, z1: 6, floor: 'floorTile', light: [0, 4] },
  { id: 'court', name: 'Courtyard', x0: -3, x1: 3, z0: -6, z1: 2, floor: 'floorStone', open: true },
  { id: 'kitchen', name: 'Kitchen & Dining', x0: 3, x1: 8, z0: -6, z1: 0, floor: 'floorTile', light: [5.7, -3.75] },
  { id: 'bedroom', name: 'Bedroom', x0: 3, x1: 8, z0: 0, z1: 6, floor: 'floorWood', light: [5.5, 3.2] },
];

const WALL_H = 3.0;
const WALL_T = 0.2;
const LIGHT_ON_INTENSITY = 7;
const LAMP_GLOW = new THREE.Color(0xffd59a);
const BLACK = new THREE.Color(0x000000);

export class CourtyardHouseSite {
  constructor(scene, collision) {
    this.scene = scene;
    this.collision = collision;
    this.M = makeMaterials();

    this.root = new THREE.Group();
    this.root.name = 'site';
    this.environment = new THREE.Group();
    this.environment.name = 'environment';
    this.house = new THREE.Group();
    this.house.name = 'courtyard-house';
    this.root.add(this.environment, this.house);
    scene.add(this.root);

    this.houseBatch = new Batcher();
    this.envBatch = new Batcher();

    this.doors = [];
    this.rooms = {};
    this.interactives = []; // { mesh, kind:'light'|'daynight', room?, pulse, worldPos }
    this.labels = [];       // { sprite, fadeStart, fadeEnd, x, z }
    this.map = { walls: [], solids: [], rooms: [], doors: [], trees: [], paths: [], water: [], custom: false };
    this.night = false;
    this.customModel = null;
    this.time = 0;

    this._buildSkyAndLights();
    this._buildEnvironment();
    this._buildReferences();
    this._buildHouse();

    this.houseBatch.build(this.house, 'house');
    this.envBatch.build(this.environment, 'env');

    this.root.updateMatrixWorld(true);
    for (const it of this.interactives) it.worldPos = it.mesh.getWorldPosition(new THREE.Vector3());

    this.setNight(false);
  }

  // ---- low-level builders --------------------------------------------------

  /** Axis-aligned box from extents. */
  box(mat, x0, x1, y0, y1, z0, z1, batch = this.houseBatch) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (w <= 0 || h <= 0 || d <= 0) return;
    batch.add(new THREE.BoxGeometry(w, h, d), mat, trs((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  }

  /** Box with size (w,h,d) centred at (x,y,z), rotated about Y. */
  boxAt(mat, w, h, d, x, y, z, ry = 0, batch = this.houseBatch) {
    batch.add(new THREE.BoxGeometry(w, h, d), mat, trs(x, y, z, ry));
  }

  cyl(mat, rTop, rBottom, h, x, y0, z, seg = 12, batch = this.houseBatch) {
    batch.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat, trs(x, y0 + h / 2, z));
  }

  /** Solid footprint for collision + minimap. */
  block(x0, x1, z0, z1, kind = 'solid') {
    this.collision.addRect(x0, z0, x1, z1);
    this.map.solids.push({ x0, x1, z0, z1, kind });
  }

  /**
   * Wall from A to B (centre line) with openings.
   * opening: { at (m from A), width, type: 'door'|'window'|'opening', sill, top, swing }
   */
  wall(ax, az, bx, bz, { h = WALL_H, t = WALL_T, ext = 0, mat = this.M.wall, openings = [] } = {}) {
    const L0 = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L0;
    const uz = (bz - az) / L0;
    const sx = ax - ux * ext;
    const sz = az - uz * ext;
    const L = L0 + ext * 2;
    const theta = Math.atan2(-uz, ux);
    const at = (d) => [sx + ux * d, sz + uz * d];

    const piece = (s, e, y0, y1, material = mat, thick = t) => {
      if (e - s < 1e-3 || y1 - y0 < 1e-3) return;
      const [cx, cz] = at((s + e) / 2);
      this.boxAt(material, e - s, y1 - y0, thick, cx, (y0 + y1) / 2, cz, theta);
    };
    const solid = (s, e) => {
      if (e - s < 1e-3) return;
      piece(s, e, 0, h);
      const [x0, z0] = at(s);
      const [x1, z1] = at(e);
      this.collision.addSegment(x0, z0, x1, z1, t / 2);
      this.map.walls.push({ x0, z0, x1, z1, low: h < 2 });
    };

    const ops = openings
      .map((o) => ({ ...o, s: o.at + ext - o.width / 2, e: o.at + ext + o.width / 2 }))
      .sort((a, b) => a.s - b.s);

    let cursor = 0;
    const F = 0.06; // frame width
    const ft = t + 0.03;
    for (const o of ops) {
      solid(cursor, o.s);
      const top = o.top ?? (o.type === 'window' ? 2.2 : 2.3);
      piece(o.s, o.e, top, h); // lintel
      if (o.type === 'window') {
        const sill = o.sill ?? 0.9;
        piece(o.s, o.e, 0, sill);
        piece(o.s, o.e, sill, top, this.M.glass, 0.02);
        // frame
        piece(o.s, o.e, sill - 0.04, sill, this.M.frame, ft + 0.04);
        piece(o.s, o.e, top - F, top, this.M.frame, ft);
        piece(o.s, o.s + F, sill, top, this.M.frame, ft);
        piece(o.e - F, o.e, sill, top, this.M.frame, ft);
        const [x0, z0] = at(o.s);
        const [x1, z1] = at(o.e);
        this.collision.addSegment(x0, z0, x1, z1, t / 2);
        this.map.walls.push({ x0, z0, x1, z1, window: true });
      } else {
        piece(o.s, o.e, top - F, top, this.M.frame, ft);
        piece(o.s - F, o.s, 0, top, this.M.frame, ft);
        piece(o.e, o.e + F, 0, top, this.M.frame, ft);
        if (o.type === 'door') {
          const [hx, hz] = at(o.s);
          const [cx, cz] = at((o.s + o.e) / 2);
          this._door(hx, hz, theta, o.width, top, o.swing ?? 1, cx, cz);
          const [x1, z1] = at(o.e);
          this.map.doors.push({ x0: hx, z0: hz, x1, z1 });
        }
      }
      cursor = o.e;
    }
    solid(cursor, L);
  }

  _door(hx, hz, theta, width, height, swing, cx, cz) {
    const pivot = new THREE.Group();
    pivot.position.set(hx, 0, hz);
    pivot.rotation.y = theta;
    const w = width - 0.03;
    const panelGeo = new THREE.BoxGeometry(w, height - 0.02, 0.045);
    panelGeo.translate(width / 2, (height - 0.02) / 2 + 0.01, 0);
    const panel = new THREE.Mesh(panelGeo, this.M.woodDark);
    const handleGeo = new THREE.BoxGeometry(0.14, 0.03, 0.12);
    handleGeo.translate(width - 0.12, 1.0, 0);
    const handle = new THREE.Mesh(handleGeo, this.M.metal);
    pivot.add(panel, handle);
    this.house.add(pivot);
    this.doors.push({ pivot, theta, swing, open: 0, cx, cz });
  }

  _tree(x, z, s = 1, batch = this.envBatch) {
    const M = this.M;
    batch.add(new THREE.CylinderGeometry(0.11 * s, 0.17 * s, 2.4 * s, 8), M.trunk, trs(x, 1.2 * s, z));
    batch.add(new THREE.IcosahedronGeometry(1.25 * s, 1), M.leaf, trs(x, 2.9 * s, z));
    batch.add(new THREE.IcosahedronGeometry(0.9 * s, 1), M.leafLight, trs(x + 0.55 * s, 3.4 * s, z - 0.3 * s));
    batch.add(new THREE.IcosahedronGeometry(0.8 * s, 1), M.leaf, trs(x - 0.5 * s, 3.6 * s, z + 0.35 * s));
    const r = 0.28 * s;
    this.collision.addRect(x - r, z - r, x + r, z + r);
    this.map.trees.push({ x, z, r: 1.25 * s });
  }

  _plant(x, z, s = 1) {
    const M = this.M;
    this.cyl(M.pot, 0.2 * s, 0.15 * s, 0.4 * s, x, 0.02, z, 10);
    this.houseBatch.add(new THREE.IcosahedronGeometry(0.32 * s, 1), M.leafLight, trs(x, 0.75 * s, z));
    this.houseBatch.add(new THREE.IcosahedronGeometry(0.22 * s, 0), M.leaf, trs(x + 0.08, 1.0 * s, z - 0.05));
    this.block(x - 0.2 * s, x + 0.2 * s, z - 0.2 * s, z + 0.2 * s);
  }

  /** Chair: `back` is the side its backrest is on: 'n' | 's' | 'e' | 'w'. */
  _chair(x, z, back, mat = this.M.wood) {
    const s = 0.22;
    this.box(mat, x - s, x + s, 0.42, 0.46, z - s, z + s);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this.box(this.M.woodDark, x + lx * (s - 0.03) - 0.02, x + lx * (s - 0.03) + 0.02, 0.02, 0.42, z + lz * (s - 0.03) - 0.02, z + lz * (s - 0.03) + 0.02);
    }
    if (back === 'n') this.box(mat, x - s, x + s, 0.46, 0.92, z - s, z - s + 0.04);
    if (back === 's') this.box(mat, x - s, x + s, 0.46, 0.92, z + s - 0.04, z + s);
    if (back === 'w') this.box(mat, x - s, x - s + 0.04, 0.46, 0.92, z - s, z + s);
    if (back === 'e') this.box(mat, x + s - 0.04, x + s, 0.46, 0.92, z - s, z + s);
    this.block(x - s, x + s, z - s, z + s);
  }

  /** A glowing material that turns on with a room light. */
  _glowMaterial(base = 0xfff4e0) {
    return new THREE.MeshLambertMaterial({ color: base, emissive: 0x000000 });
  }

  _lightSwitch(room, x, z, ry) {
    // ry orients the switch so its front faces direction (sin ry, 0, cos ry).
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    const y = 1.15;
    this.boxAt(this.M.white, 0.1, 0.14, 0.016, x + nx * 0.008, y, z + nz * 0.008, ry);
    const mat = new THREE.MeshLambertMaterial({ color: 0x222831, emissive: 0x000000 });
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.022), mat);
    btn.position.set(x + nx * 0.02, y, z + nz * 0.02);
    btn.rotation.y = ry;
    btn.name = `switch-${room.id}`;
    btn.userData.interactive = true;
    this.house.add(btn);
    const item = { mesh: btn, kind: 'light', room, pulse: 0, worldPos: null };
    room.switchItem = item;
    this.interactives.push(item);
  }

  // ---- scene sections ------------------------------------------------------

  _buildSkyAndLights() {
    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x8f8062, 1.4);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
    this.sun.position.set(10, 18, 8);
    this.root.add(this.hemi, this.sun);

    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.Fog(0xcfe6f7, 40, 120);

    this.skyBody = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xfff1c2, fog: false }),
    );
    this.root.add(this.skyBody);

    const starCount = 500;
    const pos = new Float32Array(starCount * 3);
    const rand = rng(7);
    for (let i = 0; i < starCount; i++) {
      const u = rand() * Math.PI * 2;
      const v = 0.08 + rand() * 0.9; // upper hemisphere only
      const r = 95;
      const c = Math.sqrt(1 - v * v);
      pos[i * 3] = Math.cos(u) * c * r;
      pos[i * 3 + 1] = v * r;
      pos[i * 3 + 2] = Math.sin(u) * c * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.45, fog: false }));
    this.stars.frustumCulled = false;
    this.root.add(this.stars);
  }

  _buildEnvironment() {
    const M = this.M;
    const E = this.envBatch;

    // Ground
    E.add(new THREE.PlaneGeometry(200, 200), M.grass, trs(0, 0, 0, 0, -Math.PI / 2));

    // 1 m survey grid on the front lawn (scale reference)
    const grid = new THREE.GridHelper(20, 20, 0x4e7238, 0x5f8645);
    grid.position.set(0, 0.006, 17);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    this.environment.add(grid);
    this.grid = grid;

    // Garden path (front door -> start point and beyond)
    for (let z = 6.35; z < 26; z += 0.7) {
      this.box(M.pathStone, -0.8, 0.8, 0, 0.03, z, z + 0.6, E);
    }
    this.map.paths.push({ x0: -0.8, x1: 0.8, z0: 6.2, z1: 26 });

    // Porch slab
    this.box(M.concrete, -1.6, 1.6, 0, 0.025, 6.1, 7.3, E);

    // Walking-direction arrows on the path (point north, towards the house)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.38);
    shape.lineTo(0.3, 0.02);
    shape.lineTo(0.11, 0.02);
    shape.lineTo(0.11, -0.32);
    shape.lineTo(-0.11, -0.32);
    shape.lineTo(-0.11, 0.02);
    shape.lineTo(-0.3, 0.02);
    shape.closePath();
    for (const z of [12.2, 10.1, 8.0]) {
      E.add(new THREE.ShapeGeometry(shape), M.arrow, trs(0, 0.034, z, 0, -Math.PI / 2));
    }

    // Compass rose on the lawn
    const compass = textTexture([{ text: 'N', size: 150, weight: 800 }, { text: '▲', size: 120 }], {
      width: 256, padding: 0, bg: null,
    });
    const compassMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 32),
      new THREE.MeshBasicMaterial({ map: compass.texture, transparent: true, depthWrite: false }),
    );
    compassMesh.rotation.x = -Math.PI / 2;
    compassMesh.position.set(2.6, 0.012, 14.6);
    const compassDisc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshLambertMaterial({ color: 0x2d3b4a }));
    compassDisc.rotation.x = -Math.PI / 2;
    compassDisc.position.set(2.6, 0.009, 14.6);
    this.environment.add(compassDisc, compassMesh);

    // Trees & hedges
    for (const [x, z, s] of [[-6, 10.5, 1], [6.5, 9.4, 0.9], [-12.5, 2, 1.2], [12.5, -2, 1.1], [-5.5, -10.5, 1.15], [7, -11, 1], [-14, 16, 1.3], [14, 18, 1.2], [0, -13.5, 1.2]]) {
      this._tree(x, z, s);
    }
    for (const x of [-10, 10]) {
      this.box(M.hedge, x - 0.3, x + 0.3, 0, 1.0, 8, 24, E);
      this.block(x - 0.3, x + 0.3, 8, 24, 'hedge');
    }

    // Garden bench
    this.box(M.wood, 4.6, 6.2, 0.42, 0.47, 14.6, 15.05, E);
    this.box(M.wood, 4.6, 6.2, 0.47, 0.9, 15.0, 15.06, E);
    this.box(M.dark, 4.7, 4.78, 0, 0.42, 14.65, 15.0, E);
    this.box(M.dark, 6.02, 6.1, 0, 0.42, 14.65, 15.0, E);
    this.block(4.6, 6.2, 14.6, 15.06);

    // Welcome / instructions sign
    const sx = -2.7, sz = 12.2, ry = 0.5;
    const nx = Math.sin(ry), nz = Math.cos(ry), tx = Math.cos(ry), tz = -Math.sin(ry);
    this.boxAt(M.woodDark, 1.75, 1.15, 0.06, sx, 1.45, sz, ry, E);
    for (const k of [-0.7, 0.7]) this.cyl(M.woodDark, 0.04, 0.04, 0.9, sx + tx * k, 0, sz + tz * k, 8, E);
    const sign = textTexture([
      { text: 'COURTYARD HOUSE', size: 46, weight: 800 },
      { text: 'Life-size 1:1 walkthrough', size: 28, color: '#9fd3ff' },
      { text: ' ', size: 10 },
      { text: 'Thumb + Index  →  walk forward', size: 30 },
      { text: 'Thumb + Ring  →  turn left', size: 30 },
      { text: 'Thumb + Pinky  →  turn right', size: 30 },
      { text: ' ', size: 10 },
      { text: 'Touch glowing buttons to switch lights', size: 25, color: '#ffd59a' },
      { text: 'Touch the orb in the courtyard for night', size: 25, color: '#ffd59a' },
    ], { width: 640, bg: 'rgba(20,26,36,0.96)', radius: 12 });
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.62, 1.62 / sign.aspect),
      new THREE.MeshBasicMaterial({ map: sign.texture }),
    );
    signMesh.position.set(sx + nx * 0.035, 1.45, sz + nz * 0.035);
    signMesh.rotation.y = ry;
    this.environment.add(signMesh);
    this.block(sx - 0.8, sx + 0.8, sz - 0.4, sz + 0.4);
  }

  _buildReferences() {
    const M = this.M;
    const E = this.envBatch;

    // 2.0 m measuring pole with 0.5 m bands
    const px = 1.5, pz = 13.1;
    for (let i = 0; i < 4; i++) {
      this.box(i % 2 ? M.poleWhite : M.poleRed, px - 0.04, px + 0.04, i * 0.5, (i + 1) * 0.5, pz - 0.04, pz + 0.04, E);
    }
    this.block(px - 0.1, px + 0.1, pz - 0.1, pz + 0.1);
    const poleLabel = makeLabel([{ text: '2.0 m pole', size: 40 }, { text: '0.5 m bands', size: 30, color: '#c9d4e0' }], 0.6);
    poleLabel.position.set(px, 2.35, pz);
    this.environment.add(poleLabel);
    this.labels.push({ sprite: poleLabel, x: px, z: pz, fadeStart: 18, fadeEnd: 12 });

    // 1.70 m reference person
    const hx = 1.7, hz = 11.3;
    E.add(new THREE.CapsuleGeometry(0.17, 1.05, 4, 10), M.person, trs(hx, 0.695, hz));
    E.add(new THREE.SphereGeometry(0.12, 14, 10), M.person, trs(hx, 1.58, hz));
    this.block(hx - 0.2, hx + 0.2, hz - 0.2, hz + 0.2);
    const personLabel = makeLabel([{ text: 'Person 1.70 m', size: 40 }, { text: 'eye height 1.60 m', size: 30, color: '#c9d4e0' }], 0.7);
    personLabel.position.set(hx, 2.05, hz);
    this.environment.add(personLabel);
    this.labels.push({ sprite: personLabel, x: hx, z: hz, fadeStart: 18, fadeEnd: 12 });
  }

  _buildHouse() {
    const M = this.M;

    // Floors + room lights + labels
    for (const def of ROOMS) {
      const room = { ...def, on: false, glow: [], light: null, switchItem: null };
      this.rooms[def.id] = room;
      this.box(M[def.floor], def.x0, def.x1, 0, 0.02, def.z0, def.z1);
      this.map.rooms.push({ ...def });
      const w = def.x1 - def.x0, d = def.z1 - def.z0;
      const label = makeLabel([
        { text: def.name, size: 44 },
        { text: `${w} × ${d} m  ·  ${w * d} m²`, size: 30, color: '#c9d4e0' },
      ], 1.25);
      const lz = def.labelZ ?? (def.z0 + def.z1) / 2;
      const lx = (def.x0 + def.x1) / 2;
      label.position.set(lx, def.open ? 2.7 : 2.45, lz);
      this.house.add(label);
      this.labels.push({ sprite: label, x: lx, z: lz, fadeStart: CONFIG.labelFadeStart, fadeEnd: CONFIG.labelFadeEnd });

      if (def.light) {
        const [lx2, lz2] = def.light;
        const light = new THREE.PointLight(0xffd9a6, 0, 10, 2);
        light.position.set(lx2, 2.55, lz2);
        this.house.add(light);
        room.light = light;
        const fixtureMat = this._glowMaterial();
        const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 20), fixtureMat);
        fixture.position.set(lx2, WALL_H - 0.03, lz2);
        this.house.add(fixture);
        room.glow.push(fixtureMat);
      }
    }

    // ---- Walls (outer) ----
    const win = (at, width, sill = 0.9, top = 2.2) => ({ at, width, type: 'window', sill, top });
    // South façade, with the front door
    this.wall(-8, 6, 8, 6, {
      ext: 0.1,
      openings: [win(2.5, 2.0), { at: 8, width: 1.2, type: 'door', top: 2.3, swing: 1 }, win(13.5, 2.0)],
    });
    // North façade: living | low courtyard garden wall | kitchen
    this.wall(-8, -6, -3, -6, { ext: 0.1, openings: [win(2.5, 2.4, 0.5, 2.4)] });
    this.wall(-3, -6, 3, -6, { h: 1.1, mat: M.wallAccent });
    this.wall(3, -6, 8, -6, { ext: 0.1, openings: [win(2.5, 2.0, 1.0, 2.2)] });
    // West & east façades
    this.wall(-8, -6, -8, 6, { openings: [win(6, 2.0)] });
    this.wall(8, -6, 8, 6, { openings: [win(3, 1.6), win(9, 1.6)] });

    // ---- Walls (inner) ----
    // Living | courtyard + entry
    this.wall(-3, -6, -3, 6, {
      openings: [{ at: 4, width: 3.0, type: 'opening', top: 2.6 }, { at: 10, width: 1.0, type: 'door', swing: -1 }],
    });
    // Courtyard + entry | kitchen + bedroom
    this.wall(3, -6, 3, 6, {
      openings: [{ at: 3, width: 2.4, type: 'opening', top: 2.6 }, { at: 10, width: 1.0, type: 'door', swing: 1 }],
    });
    // Entry | courtyard (glass-framed portal)
    this.wall(-3, 2, 3, 2, { openings: [{ at: 3, width: 1.8, type: 'opening', top: 2.5 }] });
    // Kitchen | bedroom
    this.wall(3, 0, 8, 0);

    // ---- Roofs (courtyard stays open to the sky) ----
    this.box(M.roof, -8.1, -2.9, WALL_H, WALL_H + 0.2, -6.1, 6.1);
    this.box(M.roof, -2.9, 2.9, WALL_H, WALL_H + 0.2, 1.9, 6.1);
    this.box(M.roof, 2.9, 8.1, WALL_H, WALL_H + 0.2, -6.1, 6.1);

    this._furnishLiving();
    this._furnishEntry();
    this._furnishCourtyard();
    this._furnishKitchen();
    this._furnishBedroom();

    // ---- Light switches (next to each room's entrance) ----
    const R = this.rooms;
    this._lightSwitch(R.living, -3.1, 2.85, -Math.PI / 2);
    this._lightSwitch(R.entry, 1.05, 5.9, Math.PI);
    this._lightSwitch(R.kitchen, 3.1, -1.3, Math.PI / 2);
    this._lightSwitch(R.bedroom, 3.1, 2.85, Math.PI / 2);
  }

  _furnishLiving() {
    const M = this.M;
    const living = this.rooms.living;
    // Rug
    this.box(M.rug, -6.9, -4.3, 0.02, 0.03, -2.6, 0.6);
    // Sofa against the west wall
    this.box(M.fabricBlue, -7.75, -6.95, 0.02, 0.45, -2.3, 0.3);
    this.box(M.fabricBlue, -7.9, -7.6, 0.02, 0.88, -2.3, 0.3);
    this.box(M.fabricBlue, -7.9, -6.95, 0.02, 0.62, -2.5, -2.3);
    this.box(M.fabricBlue, -7.9, -6.95, 0.02, 0.62, 0.3, 0.5);
    this.box(M.fabricRust, -7.58, -7.4, 0.45, 0.78, -1.9, -1.4);
    this.box(M.fabricRust, -7.58, -7.4, 0.45, 0.78, -0.6, -0.1);
    this.block(-7.9, -6.95, -2.5, 0.5);
    // Coffee table
    this.box(M.woodDark, -6.3, -5.5, 0.38, 0.42, -1.6, -0.4);
    this.box(M.woodDark, -6.2, -5.6, 0.02, 0.38, -1.5, -0.5);
    this.block(-6.3, -5.5, -1.6, -0.4);
    // Armchair facing the sofa
    this.box(M.fabricRust, -4.75, -3.95, 0.02, 0.42, -1.45, -0.65);
    this.box(M.fabricRust, -4.1, -3.95, 0.02, 0.85, -1.45, -0.65);
    this.block(-4.75, -3.95, -1.45, -0.65);
    // Floor lamp (glows with the living-room light)
    this.cyl(M.dark, 0.15, 0.15, 0.03, -7.55, 0.02, 0.9, 16);
    this.cyl(M.metal, 0.015, 0.015, 1.45, -7.55, 0.05, 0.9, 6);
    const shadeMat = this._glowMaterial(0xf4e6cc);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.28, 18, 1, true), shadeMat);
    shadeMat.side = THREE.DoubleSide;
    shade.position.set(-7.55, 1.58, 0.9);
    this.house.add(shade);
    living.glow.push(shadeMat);
    this.block(-7.7, -7.4, 0.75, 1.05);
    // Bookshelf on the west wall
    const bx0 = -7.9, bx1 = -7.58, bz0 = 2.6, bz1 = 4.6;
    this.box(M.woodDark, bx0, bx0 + 0.03, 0.02, 2.1, bz0, bz1);
    this.box(M.woodDark, bx0, bx1, 0.02, 2.1, bz0, bz0 + 0.03);
    this.box(M.woodDark, bx0, bx1, 0.02, 2.1, bz1 - 0.03, bz1);
    const rand = rng(42);
    const books = [M.book1, M.book2, M.book3, M.white];
    for (const y of [0.02, 0.52, 1.02, 1.52, 2.07]) {
      this.box(M.woodDark, bx0, bx1, y, y + 0.03, bz0, bz1);
      if (y > 2) continue;
      let z = bz0 + 0.05;
      while (z < bz1 - 0.12) {
        const w = 0.03 + rand() * 0.05;
        const h = 0.26 + rand() * 0.16;
        this.box(books[Math.floor(rand() * books.length)], bx0 + 0.04, bx1 - 0.03 - rand() * 0.04, y + 0.03, y + 0.03 + h, z, z + w);
        z += w + 0.005 + (rand() < 0.1 ? 0.08 : 0);
      }
    }
    this.block(bx0, bx1, bz0, bz1);
    // Reading chair by the south window
    this.box(M.fabricBlue, -7.0, -6.2, 0.02, 0.42, 4.8, 5.6);
    this.box(M.fabricBlue, -7.0, -6.2, 0.02, 0.85, 5.45, 5.6);
    this.block(-7.0, -6.2, 4.8, 5.6);
    this._plant(-7.55, -5.55, 1.1);
    this._plant(-3.5, 5.55, 0.9);
  }

  _furnishEntry() {
    const M = this.M;
    this.box(M.rugSoft, -0.6, 0.6, 0.02, 0.03, 5.0, 5.8); // door mat
    // Console table + vase
    this.box(M.woodDark, -2.6, -1.4, 0.76, 0.8, 5.5, 5.88);
    this.box(M.woodDark, -2.55, -2.5, 0.02, 0.76, 5.55, 5.85);
    this.box(M.woodDark, -1.5, -1.45, 0.02, 0.76, 5.55, 5.85);
    this.cyl(M.pot, 0.06, 0.08, 0.3, -2.0, 0.8, 5.7, 12);
    this.block(-2.6, -1.4, 5.5, 5.88);
    // Bench
    this.box(M.wood, 1.4, 2.6, 0.4, 0.45, 5.5, 5.88);
    this.box(M.dark, 1.45, 1.5, 0.02, 0.4, 5.52, 5.86);
    this.box(M.dark, 2.5, 2.55, 0.02, 0.4, 5.52, 5.86);
    this.block(1.4, 2.6, 5.5, 5.88);
    this._plant(-2.55, 2.55, 1);
    this._plant(2.55, 2.55, 0.8);
  }

  _furnishCourtyard() {
    const M = this.M;
    // Reflecting pool
    this.box(M.water, -2.1, 0.5, 0.02, 0.08, -5.1, -2.5);
    this.box(M.concrete, -2.3, 0.7, 0.02, 0.14, -5.3, -5.1);
    this.box(M.concrete, -2.3, 0.7, 0.02, 0.14, -2.5, -2.3);
    this.box(M.concrete, -2.3, -2.1, 0.02, 0.14, -5.1, -2.5);
    this.box(M.concrete, 0.5, 0.7, 0.02, 0.14, -5.1, -2.5);
    this.block(-2.3, 0.7, -5.3, -2.3, 'water');
    this.map.water.push({ x0: -2.1, x1: 0.5, z0: -5.1, z1: -2.5 });
    // Courtyard tree
    this._tree(-1.1, -0.7, 1.0, this.houseBatch);
    // Bench along the low garden wall
    this.box(M.wood, 1.2, 2.6, 0.42, 0.47, -5.75, -5.35);
    this.box(M.concrete, 1.25, 1.4, 0.02, 0.42, -5.72, -5.38);
    this.box(M.concrete, 2.4, 2.55, 0.02, 0.42, -5.72, -5.38);
    this.block(1.2, 2.6, -5.75, -5.35);
    // Planter
    this.box(M.concrete, 2.3, 2.85, 0.02, 0.5, -5.85, -4.55);
    for (const z of [-5.55, -4.9]) this.houseBatch.add(new THREE.IcosahedronGeometry(0.28, 1), M.leafLight, trs(2.57, 0.68, z));
    this.block(2.3, 2.85, -5.85, -4.55);

    // Day / night orb on a pedestal
    const ox = -2.45, oz = 1.45;
    this.cyl(M.concrete, 0.1, 0.14, 1.0, ox, 0.02, oz, 16);
    this.cyl(M.dark, 0.13, 0.13, 0.03, ox, 1.02, oz, 16);
    this.block(ox - 0.16, ox + 0.16, oz - 0.16, oz + 0.16);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffd36b });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 16), orbMat);
    orb.position.set(ox, 1.16, oz);
    orb.name = 'day-night-orb';
    orb.userData.interactive = true;
    this.house.add(orb);
    this.orb = orb;
    this.interactives.push({ mesh: orb, kind: 'daynight', pulse: 0, worldPos: null });
    const orbLabel = makeLabel([{ text: 'Touch: day / night', size: 36 }], 0.45);
    orbLabel.position.set(ox, 1.48, oz);
    this.house.add(orbLabel);
    this.labels.push({ sprite: orbLabel, x: ox, z: oz, fadeStart: 6, fadeEnd: 3.5 });
  }

  _furnishKitchen() {
    const M = this.M;
    const kitchen = this.rooms.kitchen;
    // North counter with sink
    this.box(M.cabinet, 3.6, 7.9, 0.02, 0.86, -5.9, -5.3);
    this.box(M.counter, 3.58, 7.9, 0.86, 0.9, -5.92, -5.28);
    this.box(M.metal, 5.0, 5.8, 0.9, 0.905, -5.8, -5.42);
    this.block(3.6, 7.9, -5.9, -5.3);
    // East counter + fridge
    this.box(M.cabinet, 7.3, 7.9, 0.02, 0.86, -5.3, -2.0);
    this.box(M.counter, 7.28, 7.9, 0.86, 0.9, -5.3, -2.0);
    this.box(M.dark, 7.45, 7.8, 0.9, 0.905, -4.6, -4.0); // cooktop
    this.block(7.3, 7.9, -5.3, -2.0);
    this.box(M.metal, 7.25, 7.9, 0.02, 2.0, -1.85, -1.0);
    this.block(7.25, 7.9, -1.85, -1.0);
    // Island
    this.box(M.cabinet, 4.8, 6.6, 0.02, 0.88, -4.1, -3.4);
    this.box(M.counter, 4.75, 6.65, 0.88, 0.92, -4.15, -3.35);
    this.block(4.75, 6.65, -4.15, -3.35);
    // Dining table + 4 chairs
    this.box(M.wood, 4.6, 6.6, 0.72, 0.76, -1.9, -1.0);
    for (const [x, z] of [[4.68, -1.82], [6.48, -1.82], [4.68, -1.12], [6.48, -1.12]]) {
      this.box(M.woodDark, x - 0.03, x + 0.03, 0.02, 0.72, z - 0.03, z + 0.03);
    }
    this.block(4.6, 6.6, -1.9, -1.0);
    this._chair(5.1, -2.3, 'n');
    this._chair(6.1, -2.3, 'n');
    this._chair(5.1, -0.6, 's');
    this._chair(6.1, -0.6, 's');
    // Pendant above the table
    this.cyl(M.dark, 0.008, 0.008, 0.75, 5.6, WALL_H - 0.75, -1.45, 4);
    const pendantMat = this._glowMaterial(0xf6e7c8);
    pendantMat.side = THREE.DoubleSide;
    const pendant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.3, 0.25, 20, 1, true), pendantMat);
    pendant.position.set(5.6, WALL_H - 0.87, -1.45);
    this.house.add(pendant);
    kitchen.glow.push(pendantMat);
  }

  _furnishBedroom() {
    const M = this.M;
    const bedroom = this.rooms.bedroom;
    // Bed with headboard against the kitchen wall
    this.box(M.woodDark, 4.8, 6.6, 0.02, 0.35, 0.1, 2.2);
    this.box(M.white, 4.85, 6.55, 0.35, 0.55, 0.15, 2.15);
    this.box(M.fabricBlue, 4.83, 6.57, 0.5, 0.6, 0.95, 2.18);
    this.box(M.white, 4.98, 5.6, 0.55, 0.68, 0.22, 0.6);
    this.box(M.white, 5.8, 6.42, 0.55, 0.68, 0.22, 0.6);
    this.box(M.woodDark, 4.8, 6.6, 0.02, 1.1, 0.1, 0.2);
    this.block(4.8, 6.6, 0.1, 2.2);
    // Nightstands with lamps (glow with the bedroom light)
    for (const x of [4.5, 6.9]) {
      this.box(M.wood, x - 0.25, x + 0.25, 0.02, 0.5, 0.12, 0.55);
      this.block(x - 0.25, x + 0.25, 0.12, 0.55);
      this.cyl(M.dark, 0.012, 0.012, 0.18, x, 0.5, 0.33, 6);
      const mat = this._glowMaterial(0xf4e6cc);
      mat.side = THREE.DoubleSide;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.15, 16, 1, true), mat);
      lamp.position.set(x, 0.72, 0.33);
      this.house.add(lamp);
      bedroom.glow.push(mat);
    }
    // Wardrobe
    this.box(M.woodDark, 7.3, 7.9, 0.02, 2.2, 4.2, 5.8);
    this.box(M.metal, 7.27, 7.3, 1.0, 1.3, 4.96, 4.98);
    this.box(M.metal, 7.27, 7.3, 1.0, 1.3, 5.02, 5.04);
    this.block(7.3, 7.9, 4.2, 5.8);
    // Desk under the south window + chair
    this.box(M.wood, 4.8, 6.2, 0.72, 0.76, 5.3, 5.85);
    this.box(M.woodDark, 4.85, 4.9, 0.02, 0.72, 5.35, 5.8);
    this.box(M.woodDark, 6.1, 6.15, 0.02, 0.72, 5.35, 5.8);
    this.block(4.8, 6.2, 5.3, 5.85);
    this._chair(5.5, 4.95, 'n', M.fabricRust);
    // Rug
    this.box(M.rugSoft, 4.3, 7.0, 0.02, 0.03, 2.3, 3.7);
  }

  // ---- runtime -------------------------------------------------------------

  setRoomLight(room, on) {
    room.on = on;
    if (room.light) room.light.intensity = on ? LIGHT_ON_INTENSITY : 0;
    for (const mat of room.glow) {
      mat.emissive.copy(on ? LAMP_GLOW : BLACK);
      mat.emissiveIntensity = on ? 1.0 : 0;
    }
    const btn = room.switchItem?.mesh.material;
    if (btn) {
      // Always glowing so switches are easy to find: green = on, amber = off.
      btn.color.set(on ? 0x2ee59d : 0xffa94d);
      btn.emissive.set(on ? 0x18a86b : 0xb35f12);
    }
  }

  toggleRoomLight(room) {
    this.setRoomLight(room, !room.on);
  }

  setNight(night) {
    this.night = night;
    const sky = night ? 0x0b1426 : 0xcfe6f7;
    this.scene.background.set(sky);
    this.scene.fog.color.set(sky);
    this.hemi.intensity = night ? 0.22 : 1.4;
    this.hemi.color.set(night ? 0x6074a8 : 0xdcecff);
    this.hemi.groundColor.set(night ? 0x1b1b24 : 0x8f8062);
    this.sun.intensity = night ? 0.25 : 1.8;
    this.sun.color.set(night ? 0x9fb6ff : 0xfff1dc);
    this.sun.position.set(night ? -12 : 10, 18, night ? -10 : 8);
    this.skyBody.position.copy(this.sun.position).normalize().multiplyScalar(92);
    this.skyBody.material.color.set(night ? 0xe2ebff : 0xfff1c2);
    this.skyBody.scale.setScalar(night ? 0.7 : 1);
    this.stars.visible = night;
    this.grid.material.opacity = night ? 0.12 : 0.55;
    this.M.water.emissive.set(night ? 0x1c6f9c : 0x0b3550);
    if (this.orb) this.orb.material.color.set(night ? 0xbcd2ff : 0xffd36b);
    // At dusk switch every room light on; the user can turn them off again.
    for (const room of Object.values(this.rooms)) {
      if (room.light) this.setRoomLight(room, night);
    }
  }

  toggleNight() {
    this.setNight(!this.night);
  }

  /** Visible, enabled interactive items. */
  getInteractives() {
    if (this.customModel) return [];
    return this.interactives;
  }

  activate(item) {
    item.pulse = 1;
    if (item.kind === 'light') this.toggleRoomLight(item.room);
    else if (item.kind === 'daynight') this.toggleNight();
  }

  findInteractive(mesh) {
    return this.interactives.find((it) => it.mesh === mesh) ?? null;
  }

  /**
   * Replace the built-in house with a loaded glTF scene (already scaled to
   * metres). The garden, references and lighting stay; collision is disabled
   * because a custom model has no collision data.
   */
  useCustomModel(object3d) {
    if (this.customModel) this.root.remove(this.customModel);
    this.customModel = object3d;
    this.house.visible = false;
    this.collision.enabled = false;
    this.map.custom = true;
    this.root.add(object3d);
  }

  update(dt, head) {
    this.time += dt;

    // Doors open automatically near the user
    const step = dt / CONFIG.doorOpenTime;
    for (const d of this.doors) {
      const near = Math.hypot(head.x - d.cx, head.z - d.cz) < CONFIG.doorTriggerDistance;
      d.open = near ? Math.min(1, d.open + step) : Math.max(0, d.open - step);
      const t = d.open * d.open * (3 - 2 * d.open);
      d.pivot.rotation.y = d.theta + d.swing * t * Math.PI * 0.5 * 0.94;
    }

    // Labels fade in when near
    for (const l of this.labels) {
      const dist = Math.hypot(head.x - l.x, head.z - l.z);
      const o = Math.max(0, Math.min(1, (l.fadeStart - dist) / (l.fadeStart - l.fadeEnd)));
      l.sprite.material.opacity = o;
      l.sprite.visible = o > 0.01;
    }

    // Button press feedback + orb idle animation
    for (const it of this.interactives) {
      if (it.pulse > 0) it.pulse = Math.max(0, it.pulse - dt * 3);
      const s = 1 + it.pulse * 0.35;
      it.mesh.scale.setScalar(s);
    }
    if (this.orb) {
      const bob = 1 + Math.sin(this.time * 2.2) * 0.06;
      this.orb.scale.multiplyScalar(bob);
    }
  }
}

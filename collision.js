// 2D (top-down X/Z) collision for virtual locomotion. Pure JS, unit-tested.
// It only limits *artificial* movement (pinch-walk / keyboard / turn). It can
// never stop the user's physical walking in their play space.

export function pointSegmentDistanceSq(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t - px;
  const cz = az + abz * t - pz;
  return cx * cx + cz * cz;
}

export function circleHitsSegment(px, pz, r, s) {
  const reach = r + s.pad;
  return pointSegmentDistanceSq(px, pz, s.ax, s.az, s.bx, s.bz) < reach * reach;
}

export function circleHitsRect(px, pz, r, b) {
  const cx = Math.max(b.minX, Math.min(px, b.maxX));
  const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz < r * r;
}

export class CollisionWorld {
  constructor() {
    this.segments = [];
    this.rects = [];
    this.enabled = true;
  }

  clear() {
    this.segments.length = 0;
    this.rects.length = 0;
  }

  /** Wall centre-line from A to B; `pad` = half the wall thickness. */
  addSegment(ax, az, bx, bz, pad = 0.1) {
    this.segments.push({ ax, az, bx, bz, pad });
  }

  addRect(x0, z0, x1, z1) {
    this.rects.push({
      minX: Math.min(x0, x1), maxX: Math.max(x0, x1),
      minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1),
    });
  }

  collides(x, z, r) {
    if (!this.enabled) return false;
    for (const s of this.segments) if (circleHitsSegment(x, z, r, s)) return true;
    for (const b of this.rects) if (circleHitsRect(x, z, r, b)) return true;
    return false;
  }

  /**
   * Try to move (x,z) by (dx,dz). Slides along walls by testing each axis
   * separately. If the body is already inside geometry (e.g. the user
   * physically leaned through a wall) movement is allowed so they can't get stuck.
   */
  resolveMove(x, z, dx, dz, r) {
    if (!this.enabled || this.collides(x, z, r)) return { x: x + dx, z: z + dz, blocked: false };
    if (!this.collides(x + dx, z + dz, r)) return { x: x + dx, z: z + dz, blocked: false };
    if (dx !== 0 && !this.collides(x + dx, z, r)) return { x: x + dx, z, blocked: true };
    if (dz !== 0 && !this.collides(x, z + dz, r)) return { x, z: z + dz, blocked: true };
    return { x, z, blocked: true };
  }
}

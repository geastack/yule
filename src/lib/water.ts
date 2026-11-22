import { random } from "./frame";
import type { Motion } from "./motion";

// The water in the globe, relative to the glass, in world units (the globe's
// radius) per second:
// - a spin in two layers: the water by the glass catches up with it in
//   about 2.5 s, the core catches up with that layer in about 8 s, so a
//   turn shears the snow cloud instead of spinning it as one;
// - whirlpools: a turn or a jolt sheds a few smoothed vortices, each with
//   its own place, axis, size and life, drifting with the spin;
// - fine eddies: a few random plane waves (divergence-free: each one's flow
//   is across its wave) at two sizes, drifting each its own way so the
//   pattern changes shape, stirred by jolts and turns and dying over ~7 s.
// lib/snow.ts sums them per flake; `prepare` hands it the frame's numbers
// in Q12 fixed point.

const ONE = 4096;
const WALL_SPIN_S = 1;
const CORE_SPIN_S = 4;
const MAX_SPIN = 3; // rad/s of spin relative to the glass

export const BLOBS = 4;
const BLOB_REACH = 0.7; // whirlpools stay this far inside the glass
const BLOB_CORE_LOW = 0.25;
const BLOB_CORE_HIGH = 0.4;
const BLOB_LIFE_LOW_S = 4;
const BLOB_LIFE_HIGH_S = 8;
const BLOB_STRENGTH = 0.6; // whirlpool strength from a full jolt (peak speed ~ 0.33 Γ / core)
const BLOB_COST = 0.3; // stirring that sheds one whirlpool
const BLOB_GONE = 0.02;
// Stirring per second: per rad/s the glass turns past SLOW_TURN, per m/s²
// of jolt past JOLT_START, both growing smoothly from nothing. A slow turn
// (turning the globe over to watch the snow fall) only changes gravity.
const TURN_STIR = 0.6;
const SLOW_TURN = 2; // rad/s
const JOLT_START = 3;
const JOLT_STIR = 0.12;

export const MODES = 4;
const MODE_WAVELENGTHS = [0.6, 0.6, 0.3, 0.3];
const EDDY_MAX = 0.2; // units/s
const EDDY_S = 7;
const EDDY_FROM_TURN = 0.15; // eddy speed gained per rad/s per second
const EDDY_FROM_JOLT = 0.05; // per m/s² of jolt past JOLT_START per second
const TO_TABLE = 1024 / (2 * Math.PI);

const DRAG_SPIN = 1.5; // spin (rad/s) per radian a finger sweeps
const DRAG_REACH = 1600; // px²: a drag near the centre turns no faster than at 40 px
const TAP_STIR = 0.35;
const GUST_EDDIES = 0.25; // eddy speed a full gust feeds in per second

export class Water {
  // Relative spin (Q12 rad/s) of the layer by the glass and of the core.
  readonly wall = new Int32Array(3);
  readonly core = new Int32Array(3);
  // Whirlpools, 8 numbers each (Q12): centre x y z, unit axis x y z,
  // strength times core radius², core radius²; the first `blobCount` live.
  readonly blob = new Int32Array(BLOBS * 8);
  blobCount = 0;
  // Eddy waves, 7 numbers each: wavevector x y z (sine-table steps per
  // unit), phase (steps), flow x y z (Q12 units/s, times the eddies).
  readonly wave = new Int32Array(MODES * 7);
  eddies = 0; // eddy speed, units/s
  // Biggest speed any part of the water could have now (units/s): below
  // the least grip, resting snow is not even looked at.
  reach = 0;

  // The water's own spin (rad/s) by the glass and in the core.
  private readonly wallSpin = new Float64Array(3);
  private readonly coreSpin = new Float64Array(3);
  private readonly blobs = new Float64Array(BLOBS * 8); // x y z ax ay az strength life
  private readonly core2 = new Float64Array(BLOBS);
  private readonly waves = new Float64Array(MODES * 7); // k(3) a(3) phase speed
  private readonly phases = new Float64Array(MODES);
  private readonly glass = new Float64Array(3);
  private readonly unit = new Float64Array(3); // scratch for random directions
  private pending = 0;

  init() {
    for (let m = 0; m < MODES; m++) {
      // A random direction for the wave, and a flow across it.
      const size = (2 * Math.PI) / MODE_WAVELENGTHS[m];
      const at = m * 7;
      this.randomUnit();
      for (let c = 0; c < 3; c++) this.waves[at + c] = this.unit[c] * size;
      this.across();
      for (let c = 0; c < 3; c++) this.waves[at + 3 + c] = this.unit[c];
      this.waves[at + 6] = (0.6 + random() * 0.9) * (random() < 0.5 ? -1 : 1);
      this.phases[m] = random() * 2 * Math.PI;
      for (let c = 0; c < 3; c++) this.wave[m * 7 + c] = Math.round(this.waves[at + c] * TO_TABLE);
    }
  }

  // A hard shake, as at boot.
  shake(strength: number) {
    for (let i = 0; i < 5; i++) this.shed(BLOB_STRENGTH * strength * (0.7 + 0.6 * random()));
    this.eddies = Math.min(EDDY_MAX, this.eddies + EDDY_MAX * strength);
  }

  tap() {
    this.shed(TAP_STIR);
    this.eddies = Math.min(EDDY_MAX, this.eddies + TAP_STIR * 0.3);
  }

  // A gust churns the water a little, so its current breaks into eddies.
  blow(gust: number, dt: number) {
    this.eddies = Math.min(EDDY_MAX, this.eddies + gust * GUST_EDDIES * dt);
  }

  // A finger moved by (dx, dy) px at (offsetX, offsetY) px from the globe's
  // centre (screen axes, y down): the water by the glass turns with it.
  drag(dx: number, dy: number, offsetX: number, offsetY: number) {
    const reach = Math.max(DRAG_REACH, offsetX * offsetX + offsetY * offsetY);
    const turn = ((offsetY * dx - offsetX * dy) / reach) * DRAG_SPIN;
    this.wallSpin[2] += turn;
    this.coreSpin[2] += turn * 0.5;
  }

  step(dt: number, motion: Motion) {
    const glass = this.glass;
    glass[0] = motion.spinX;
    glass[1] = motion.spinY;
    glass[2] = motion.spinZ;
    const turning = Math.sqrt(glass[0] * glass[0] + glass[1] * glass[1] + glass[2] * glass[2]);
    const jolt = Math.max(0, motion.jolt - JOLT_START);

    // The layers catch up: the wall with the glass, the core with the wall.
    const toWall = 1 - Math.exp(-dt / WALL_SPIN_S);
    const toCore = 1 - Math.exp(-dt / CORE_SPIN_S);
    for (let c = 0; c < 3; c++) {
      this.wallSpin[c] += (glass[c] - this.wallSpin[c]) * toWall;
      this.coreSpin[c] += (this.wallSpin[c] - this.coreSpin[c]) * toCore;
      this.wall[c] = q12(clampSpin(this.wallSpin[c] - glass[c]));
      this.core[c] = q12(clampSpin(this.coreSpin[c] - glass[c]));
    }

    // Stirring sheds whirlpools and feeds the eddies, in proportion to how
    // hard the glass is shaken or twisted.
    const twist = Math.max(0, turning - SLOW_TURN);
    this.pending += (twist * TURN_STIR + jolt * JOLT_STIR) * dt;
    while (this.pending >= BLOB_COST) {
      this.pending -= BLOB_COST;
      this.shed(BLOB_STRENGTH * Math.min(1, 0.2 + jolt / 12 + twist / 4));
    }
    this.eddies += (twist * EDDY_FROM_TURN + jolt * EDDY_FROM_JOLT) * dt;
    this.eddies = Math.min(EDDY_MAX, this.eddies) * Math.exp(-dt / EDDY_S);
    if (this.eddies < 0.005) this.eddies = 0;

    this.moveBlobs(dt);
    this.moveWaves(dt);
    let spin = 0;
    for (let c = 0; c < 3; c++) spin += Math.abs(this.wall[c]) + Math.abs(this.core[c]);
    let swirl = 0;
    for (let b = 0; b < this.blobCount; b++) swirl += this.blobs[b * 8 + 6];
    this.reach = (spin / ONE) * 0.6 + swirl * 2 + this.eddies * 2;
  }

  // Whirlpools fade, each at its own pace, and drift with the spin.
  private moveBlobs(dt: number) {
    const blobs = this.blobs;
    let alive = 0;
    for (let b = 0; b < this.blobCount; b++) {
      const at = b * 8;
      const strength = blobs[at + 6] * Math.exp(-dt / blobs[at + 7]);
      if (strength < BLOB_GONE) continue;

      const x = blobs[at];
      const y = blobs[at + 1];
      const z = blobs[at + 2];
      const blend = x * x + y * y + z * z;
      const sx = (this.core[0] + (this.wall[0] - this.core[0]) * blend) / ONE;
      const sy = (this.core[1] + (this.wall[1] - this.core[1]) * blend) / ONE;
      const sz = (this.core[2] + (this.wall[2] - this.core[2]) * blend) / ONE;
      const to = alive * 8;
      blobs[to] = x + (sy * z - sz * y) * dt;
      blobs[to + 1] = y + (sz * x - sx * z) * dt;
      blobs[to + 2] = z + (sx * y - sy * x) * dt;
      for (let c = 3; c < 6; c++) blobs[to + c] = blobs[at + c];
      blobs[to + 6] = strength;
      blobs[to + 7] = blobs[at + 7];
      this.core2[alive] = this.core2[b];
      alive++;
    }
    this.blobCount = alive;
    for (let b = 0; b < alive; b++) {
      const at = b * 8;
      for (let c = 0; c < 6; c++) this.blob[at + c] = q12(blobs[at + c]);
      this.blob[at + 6] = q12(blobs[at + 6] * this.core2[b]);
      this.blob[at + 7] = q12(this.core2[b]);
    }
  }

  private moveWaves(dt: number) {
    for (let m = 0; m < MODES; m++) {
      const at = m * 7;
      this.phases[m] = (this.phases[m] + this.waves[at + 6] * dt) % (2 * Math.PI);
      this.wave[m * 7 + 3] = Math.round(this.phases[m] * TO_TABLE);
      for (let c = 0; c < 3; c++) this.wave[m * 7 + 4 + c] = q12(this.waves[at + 3 + c] * this.eddies);
    }
  }

  // A random unit vector into `unit`.
  private randomUnit() {
    let length = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    while (length < 0.1 || length > 1) {
      x = random() * 2 - 1;
      y = random() * 2 - 1;
      z = random() * 2 - 1;
      length = Math.sqrt(x * x + y * y + z * z);
    }
    this.unit[0] = x / length;
    this.unit[1] = y / length;
    this.unit[2] = z / length;
  }

  // Turns unit vector `unit` into one at right angles to it.
  private across() {
    const kx = this.unit[0];
    const ky = this.unit[1];
    const kz = this.unit[2];
    // Crossed with x, or with y when k is close to x.
    const nearX = Math.abs(kx) >= 0.9;
    const x = nearX ? -kz : 0;
    const y = nearX ? 0 : kz;
    const z = nearX ? kx : -ky;
    const length = Math.sqrt(x * x + y * y + z * z);
    this.unit[0] = x / length;
    this.unit[1] = y / length;
    this.unit[2] = z / length;
  }

  // A new whirlpool somewhere inside, replacing the weakest when full.
  private shed(strength: number) {
    const blobs = this.blobs;
    let b = this.blobCount;
    if (b >= BLOBS) {
      b = 0;
      for (let i = 1; i < BLOBS; i++) if (blobs[i * 8 + 6] < blobs[b * 8 + 6]) b = i;
    } else {
      this.blobCount++;
    }

    const at = b * 8;
    const distance = BLOB_REACH * Math.cbrt(random());
    this.randomUnit();
    for (let c = 0; c < 3; c++) blobs[at + c] = this.unit[c] * distance;
    this.randomUnit();
    for (let c = 0; c < 3; c++) blobs[at + 3 + c] = this.unit[c];
    blobs[at + 6] = strength;
    blobs[at + 7] = BLOB_LIFE_LOW_S + random() * (BLOB_LIFE_HIGH_S - BLOB_LIFE_LOW_S);
    const radius = BLOB_CORE_LOW + random() * (BLOB_CORE_HIGH - BLOB_CORE_LOW);
    this.core2[b] = radius * radius;
  }
}

function q12(value: number): number {
  return Math.round(value * ONE);
}

function clampSpin(radiansPerSecond: number): number {
  return Math.max(-MAX_SPIN, Math.min(MAX_SPIN, radiansPerSecond));
}

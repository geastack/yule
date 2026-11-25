import type { Motion } from "./motion";

// Motion and touch drive the smoke's local swirl and the snow's lift pulse.
const ONE = 4096;
const WALL_SPIN_S = 0.7;
const MAX_SPIN = 3; // rad/s of spin relative to the glass

const SLOW_TURN = 2;
const JOLT_START = 3;
const EDDY_MAX = 0.2; // units/s
const EDDY_S = 2.5;
const EDDY_FROM_TURN = 0.15; // eddy speed gained per rad/s per second
const EDDY_FROM_JOLT = 0.05; // per m/s² of jolt past JOLT_START per second

const DRAG_SPIN = 1.5; // spin (rad/s) per radian a finger sweeps
const DRAG_REACH = 1600; // px²: a drag near the centre turns no faster than at 40 px
const TAP_STIR = 0.35;
const LIFT_PULSE_S = 0.13;
const GUST_EDDIES = 0.25; // eddy speed a full gust feeds in per second

export class Water {
  // Relative spin near the glass (Q12 rad/s), for chimney smoke.
  readonly wall = new Int32Array(3);
  eddies = 0; // eddy speed, units/s
  // Recent mechanical agitation strong enough to lift settled snow.
  liftPulse = 0;
  private pendingLift = 0;

  private readonly wallSpin = new Float64Array(3);
  private readonly glass = new Float64Array(3);

  // A hard shake, as at boot.
  shake(strength: number) {
    this.eddies = Math.min(EDDY_MAX, this.eddies + EDDY_MAX * strength);
    this.pendingLift = Math.max(this.pendingLift, strength);
  }

  tap() {
    this.eddies = Math.min(EDDY_MAX, this.eddies + TAP_STIR * 0.3);
    this.pendingLift = Math.max(this.pendingLift, 0.28);
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
    this.liftPulse = Math.max(this.liftPulse, Math.min(0.6, Math.abs(turn) * 3));
    this.wallSpin[2] += turn;
  }

  step(dt: number, motion: Motion) {
    const glass = this.glass;
    glass[0] = motion.spinX;
    glass[1] = motion.spinY;
    glass[2] = motion.spinZ;
    const turning = Math.sqrt(glass[0] * glass[0] + glass[1] * glass[1] + glass[2] * glass[2]);
    const jolt = Math.max(0, motion.jolt - JOLT_START);

    // The water near the glass follows its spin.
    const toWall = 1 - Math.exp(-dt / WALL_SPIN_S);
    for (let c = 0; c < 3; c++) {
      this.wallSpin[c] += (glass[c] - this.wallSpin[c]) * toWall;
      this.wall[c] = q12(clampSpin(this.wallSpin[c] - glass[c]));
    }

    // A sharp move lifts snow and briefly stirs the smoke.
    const twist = Math.max(0, turning - SLOW_TURN);
    this.liftPulse = Math.max(
      this.liftPulse * Math.exp(-dt / LIFT_PULSE_S),
      this.pendingLift,
      Math.max(0, motion.jolt - 0.4) / 12,
      twist * 0.1,
    );
    this.pendingLift = 0;
    this.eddies += (twist * EDDY_FROM_TURN + jolt * EDDY_FROM_JOLT) * dt;
    this.eddies = Math.min(EDDY_MAX, this.eddies) * Math.exp(-dt / EDDY_S);
    if (this.eddies < 0.005) this.eddies = 0;
  }
}

function q12(value: number): number {
  return Math.round(value * ONE);
}

function clampSpin(radiansPerSecond: number): number {
  return Math.max(-MAX_SPIN, Math.min(MAX_SPIN, radiansPerSecond));
}

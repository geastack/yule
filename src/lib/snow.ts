import {
  CENTRE_X,
  CENTRE_Y,
  HEIGHT,
  RADIUS_X,
  RADIUS_Y,
  random,
  SPREAD,
  spread,
  TILT_COS,
  TILT_SIN,
  WIDTH,
} from "./frame";
import type { Motion } from "./motion";
import { type Painter, PHASES, Sprites } from "./painter";
import { GRID, type Scene } from "./scene";
import type { Water } from "./water";
import type { Wind } from "./wind";

export const FLAKES = 1200;

// The flakes live in Q12 fixed point (ONE = 1 world unit, the globe's
// radius; speeds in units/s). Hot loops count with plain numbers and index
// typed arrays by them directly, which the compiler turns into unchecked
// array access; the maths in them is `i32`.
const ONE = 4096;
const SHIFT = 12;
const WALL = Math.round(0.93 * ONE); // flakes stay this far inside the glass
const WALL_SQUARED = WALL * WALL;

// Each flake is its own: how fast it falls, how closely it follows the
// water, how it glides, rocks and wanders. Fall speeds are lognormal: a
// median flake takes ~14 s to fall the globe, the fastest ~6 s, the
// slowest ~30 s; bigger flakes fall faster.
const FALL_MEDIAN = 0.11;
const FALL_SPREAD = 0.4; // sigma of ln(speed)
const LAG_LOW_S = 0.02; // how long a flake takes to follow the water
const LAG_HIGH_S = 0.12;
const LAGS = 16; // lag times in a table, recomputed for each frame's dt
const GLIDE = 0.4; // sideways glide, at most this share of the fall
const SPIRAL = 0.5; // rad/s the glide turns at, for the flakes that spiral
const SPIRALLERS = 0.3;
const ROCK_LOW_HZ = 0.4;
const ROCK_HIGH_HZ = 1.5;
const WANDER = 0.05; // a random walk on top (units/s), losing its memory in
const WANDER_S = 1; // about a second
const GLITTER = 0.15; // share of flakes that flash instead of shimmering
// A resting flake's grip: how stirred the water must be (water.reach x
// LIFT_SHARE) to lift it. A gentle shake lifts the loose snow, a firm one
// nearly all of it, and throws it anywhere up to the top of the globe.
const GRIP_LOW = 0.1;
const GRIP_HIGH = 0.6;
const LIFT_SHARE = 0.2;
// A gust lifts loose snow as stirring this strong would, as a low spray off
// the windward half of the ground and roofs.
const GUST_LIFT = 0.35;
const SPRAY_RISE = Math.round(0.45 * ONE);
// Landing needs the water at the flake slower than this (|ux|+|uy|+|uz|).
const SETTLE_SPEED = Math.round(0.3 * ONE);
// Resting snow stays put until down turns past its own grip angle,
// GRIP_ANGLE_LOW-GRIP_ANGLE_HIGH degrees. Snow on the ground and roofs
// reads only the tilt across the screen, and none below TILTED (the sine of
// the board's lean from flat): lying flat, it stays put.
const GRIP_ANGLE_LOW = 20;
const GRIP_ANGLE_HIGH = 35;
const TILTED = 0.35;
const LOOK_AGAIN = Math.round(0.99 * ONE * ONE); // down turned ~8° since the last look
const LOOK_S = 0.5; // and resting snow is looked at for this long after
// Where it lies: in the water, on the ground or a roof (hidden: the
// painting has that snow already), or against the glass (drawn).
const AFLOAT = 0;
const ON_GROUND = 1;
const ON_GLASS = 2;
// A jolt of the glass pushes the snow the other way, as gravity would:
// effective gravity is g - a (in g), at most MAX_PULL g.
const STANDARD_GRAVITY = 9.80665;
const MAX_PULL = 3;
// Snow slides down the glass until the glass under it is this level
// (cosine of its slope), its own between HOLD_LOW and HOLD_HIGH: so it heaps
// round the low point instead of gathering on it.
const HOLD_LOW = 0.45;
const HOLD_HIGH = 0.9;
// A lifted flake comes back somewhere within ±SCATTER across, CLEARANCE above
// the ground or a roof.
const SCATTER = Math.round(0.8 * ONE);
const CLEARANCE = Math.round(0.03 * ONE);
const FRICTION = Math.round(0.98 * ONE); // speed kept sliding along the glass
// The flow's push out through the glass fades to nothing from RAMP_START
// (r², x 4096) to the wall: it slides along the glass instead.
const RAMP_START = Math.round(0.6 * ONE);
const FLOOR_RAMP_SHIFT = 9;
const FLOOR_RAMP = 1 << FLOOR_RAMP_SHIFT; // 0.125 units above the ground

// Projection to the panel in 1/16 px, with a little perspective: offsets
// grow by 1 / (1 - PERSPECTIVE z) toward the viewer.
const PERSPECTIVE = 0.2;
const CENTRE_X16 = Math.round(CENTRE_X * 16);
const CENTRE_Y16 = Math.round(CENTRE_Y * 16);
const RADIUS_X16 = Math.round(RADIUS_X * 16);
const RADIUS_Y16 = Math.round(RADIUS_Y * 16);
const COS = Math.round(TILT_COS * ONE);
const SIN = Math.round(TILT_SIN * ONE);

// Sprites by radius (x 256 px): below 0.75 px a 2 x 2 dot, then flat
// plastic chips, as a globe's snow is, about 2-6 px across. Each size comes
// in two orientations and four tumble states, from edge-on (thin, dim) to
// face-on (round, bright), so every flake visibly tumbles as it sinks.
const CHIPS = [0.9, 1.2, 1.6, 2, 2.5]; // radius, by size class
const LIMITS = [192, 269, 358, 461, 576];
const CHIP_SOFT = 0.7;
const CHIP_RAGGED = 0.15;
const TUMBLES = [0.3, 0.5, 0.75, 1]; // width across, edge-on to face-on
const TURNS = [0.4, 2]; // radians, the two orientations
const NEAR = Math.round(0.55 * ONE); // nearer than this is out of focus
const SNOW = spread(0xef7f); // (232, 238, 250)
const MAX_DOTS = 4096; // the painter's point list
const MAX_BIG = 1024;
const DOT_GAIN = 52; // a dot's 2 x 2 spread, brightened to read as one pixel
const TO_TABLE = 1024 / (2 * Math.PI); // radians to sine-table steps

// The sine of 1024 steps per turn, Q12; reciprocals 2^24 / (16 i + 8) for
// the whirlpools; perspective by depth; the glass's free-slip ramp by r².
const SINE = new Int32Array(1024);
const RECIPROCAL = new Int32Array(1024);
const DEPTH_SCALE = new Int32Array(256);
const RAMP = new Int32Array(256);
const CLASS_LIMITS = new Int32Array(LIMITS.length);

for (let i = 0; i < 1024; i++) {
  SINE[i] = Math.round(Math.sin((i * Math.PI) / 512) * ONE);
  RECIPROCAL[i] = Math.round(16777216 / (i * 16 + 8));
}
for (let i = 0; i < 256; i++) {
  const z = (i + 0.5) / 128 - 1;
  DEPTH_SCALE[i] = Math.round(ONE / (1 - PERSPECTIVE * z));
  const r2 = (i * 16 + 8) / ONE;
  const start = RAMP_START / ONE;
  const end = WALL_SQUARED / ONE / ONE;
  const t = Math.min(1, Math.max(0, (r2 - start) / (end - start)));
  RAMP[i] = Math.round(((t * t * (3 - 2 * t)) / r2) * ONE);
}
for (let i = 0; i < LIMITS.length; i++) CLASS_LIMITS[i] = LIMITS[i];

// The snow: flakes in the unit sphere of water, each falling its own way
// through the water's spin, whirlpools and eddies, landing on the ground,
// roofs and car and lying there, hidden, until the water moves fast enough
// to lift that flake, or the watch tilts hard.
export class Snow {
  private readonly x = new Int32Array(FLAKES);
  private readonly y = new Int32Array(FLAKES);
  private readonly z = new Int32Array(FLAKES);
  private readonly vx = new Int32Array(FLAKES);
  private readonly vy = new Int32Array(FLAKES);
  private readonly vz = new Int32Array(FLAKES);
  // The random walk's velocity (Q12).
  private readonly wanderX = new Int32Array(FLAKES);
  private readonly wanderY = new Int32Array(FLAKES);
  private readonly wanderZ = new Int32Array(FLAKES);
  private readonly fall = new Int32Array(FLAKES); // Q12 units/s
  private readonly lag = new Uint8Array(FLAKES); // index into the lag table
  // Glide: speed (Q12), heading and its turn rate (sine-table steps x 256,
  // and per second); rocking: phase and rate (the same), sideways speed.
  private readonly glide = new Int32Array(FLAKES);
  private readonly heading = new Int32Array(FLAKES);
  private readonly turn = new Int32Array(FLAKES);
  private readonly rock = new Int32Array(FLAKES);
  private readonly rockRate = new Int32Array(FLAKES);
  private readonly sway = new Int32Array(FLAKES);
  // Looks: radius (x 256 px), brightness (0..256), glint phase and rate,
  // and whether it is glitter.
  private readonly size = new Int32Array(FLAKES);
  private readonly shade = new Int32Array(FLAKES);
  private readonly glint = new Int32Array(FLAKES);
  private readonly glintRate = new Int32Array(FLAKES);
  private readonly glitter = new Uint8Array(FLAKES);
  // Water speed (Q12) that lifts it when resting.
  private readonly grip = new Int32Array(FLAKES);
  // Scene-down (Q12) when it came to rest; it slides when that turns.
  // Down (Q12) when it came to rest: in the screen's plane on the ground,
  // in 3D against the glass. Its grip angle's cosine (Q12).
  private readonly restX = new Int32Array(FLAKES);
  private readonly restY = new Int32Array(FLAKES);
  private readonly restZ = new Int32Array(FLAKES);
  private readonly stick = new Int32Array(FLAKES);
  private readonly hold = new Int32Array(FLAKES); // see HOLD_LOW
  // 1 while resting on the ground, a roof or level glass: not drawn (the
  // painting has its snow already), only checked now and then for a lift.
  private readonly resting = new Uint8Array(FLAKES);
  private readonly lagTimes = new Float64Array(LAGS);
  private readonly follow = new Int32Array(LAGS); // Q12 share of the gap closed this frame
  private readonly sprites = new Sprites();
  // Snow at rest on the glass is baked into the settled picture once
  // (Painter.bake) instead of drawn every frame; when any of it lets go,
  // the settled picture is rebuilt and the rest baked again.
  private readonly baked = new Uint8Array(FLAKES);
  private unbaked = false;
  resettled = false; // the settled picture was rebuilt this frame (sway redraws)
  private readonly bakeId = new Int32Array(FLAKES);
  private readonly bakeX = new Int32Array(FLAKES);
  private readonly bakeY = new Int32Array(FLAKES);
  private readonly bakeLight = new Int32Array(FLAKES);
  private readonly bakeFlake = new Int32Array(FLAKES);
  // This frame's big chips (sprite, 1/16 px place, light), blended after
  // the flake loop.
  private readonly bigId = new Int32Array(MAX_BIG);
  private readonly bigX = new Int32Array(MAX_BIG);
  private readonly bigY = new Int32Array(MAX_BIG);
  private readonly bigLight = new Int32Array(MAX_BIG);
  // Chip sprite ids: (size class x 2 + orientation) x 4 + tumble state.
  private readonly chips = new Int32Array(CHIPS.length * TURNS.length * TUMBLES.length);
  // Scene-down (Q12) when resting snow was last checked.
  private checkedX = 0;
  private checkedY = -ONE;
  private checkedZ = 0;
  private sinceTurn = LOOK_S;
  private frame = 0;
  private seed = 0x6d2b79f5;
  // The landing height map (scene.ts), taken by `settle`.
  private ground = new Int32Array(0);

  init() {
    for (let c = 0; c < CHIPS.length; c++) {
      for (let o = 0; o < TURNS.length; o++) {
        for (let t = 0; t < TUMBLES.length; t++) {
          const at = (c * TURNS.length + o) * TUMBLES.length + t;
          this.chips[at] = this.sprites.addChip(CHIPS[c], CHIP_SOFT, TUMBLES[t], TURNS[o], CHIP_RAGGED);
        }
      }
    }
    for (let b = 0; b < LAGS; b++) this.lagTimes[b] = LAG_LOW_S + ((LAG_HIGH_S - LAG_LOW_S) * b) / (LAGS - 1);
    for (let i = 0; i < FLAKES; i++) this.individual(i);
  }

  private individual(i: number) {
    // One normal draw sets both fall speed and size: big flakes fall fast.
    const normal = Math.max(-2.2, Math.min(2.2, (random() + random() + random() - 1.5) * 2));
    const big = (normal + 2.2) / 4.4;
    const fall = FALL_MEDIAN * Math.exp(FALL_SPREAD * normal);
    this.fall[i] = Math.round(fall * ONE);
    this.size[i] = Math.round((0.7 + 1.9 * big ** 1.3 + 0.2 * random()) * 256);
    this.lag[i] = Math.min(LAGS - 1, Math.floor((0.25 * random() + 0.75 * big) * LAGS));
    this.glide[i] = Math.round(fall * GLIDE * random() * ONE);
    this.heading[i] = Math.floor(random() * 1024 * 256);
    const spirals = random() < SPIRALLERS;
    this.turn[i] = spirals ? Math.round(SPIRAL * (random() * 2 - 1) * TO_TABLE * 256) : 0;
    this.rock[i] = Math.floor(random() * 1024 * 256);
    const hz = ROCK_LOW_HZ + random() * (ROCK_HIGH_HZ - ROCK_LOW_HZ);
    this.rockRate[i] = Math.round(hz * 1024 * 256);
    this.sway[i] = Math.round(fall * (0.1 + 0.3 * big) * ONE);
    this.glitter[i] = random() < GLITTER ? 1 : 0;
    this.shade[i] = Math.round((0.8 + 0.2 * random()) * 256);
    this.glint[i] = Math.floor(random() * 1024 * 256);
    this.glintRate[i] = Math.round((0.3 + random() * 1.2) * 1024 * 256);
    this.grip[i] = Math.round((GRIP_LOW + random() * (GRIP_HIGH - GRIP_LOW)) * ONE);
    const angle = GRIP_ANGLE_LOW + random() * (GRIP_ANGLE_HIGH - GRIP_ANGLE_LOW);
    this.stick[i] = Math.round(Math.cos((angle * Math.PI) / 180) * ONE);
    this.hold[i] = Math.round((HOLD_LOW + random() * (HOLD_HIGH - HOLD_LOW)) * ONE);
  }

  // Every flake somewhere in the water, as a globe is just after a shake.
  spread(scene: Scene) {
    const ground = scene.ground;
    this.ground = ground;
    for (let i = 0; i < FLAKES; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = Math.round((random() * 2 - 1) * WALL);
        y = Math.round((random() * 2 - 1) * WALL);
        z = Math.round((random() * 2 - 1) * WALL);
        if (x * x + y * y + z * z < WALL_SQUARED && y > ground[cellOf(x, z)]) break;
      }
      this.x[i] = x;
      this.y[i] = y;
      this.z[i] = z;
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.vz[i] = 0;
      this.resting[i] = AFLOAT;
      this.baked[i] = 0;
    }
  }

  // Every flake lying on the ground or a roof, as in a globe left standing.
  settle(scene: Scene) {
    const ground = scene.ground;
    this.ground = ground;
    for (let i = 0; i < FLAKES; i++) {
      const x = Math.round((random() * 2 - 1) * SCATTER);
      const z = Math.round((random() * 2 - 1) * SCATTER);
      this.x[i] = x;
      this.z[i] = z;
      this.y[i] = ground[cellOf(x, z)];
      this.resting[i] = ON_GROUND;
      this.restX[i] = 0;
      this.restY[i] = -ONE;
      this.restZ[i] = 0;
    }
  }

  step(dt: number, motion: Motion, water: Water, wind: Wind) {
    for (let b = 0; b < LAGS; b++) this.follow[b] = Math.round((1 - Math.exp(-dt / this.lagTimes[b])) * ONE);
    const wanderKeep = Math.exp(-dt / WANDER_S);
    // Uniform kicks of ±512 scaled to the walk's spread (uniform σ = 1/√12).
    const wanderKick = Math.round(((WANDER * Math.sqrt(1 - wanderKeep * wanderKeep)) / 0.2887) * ONE);

    // Resting snow is only looked at, a quarter of it each frame, when the
    // water could lift some of it or down has turned since it was checked.
    const downX = Math.round(motion.downX * ONE);
    const downY = Math.round(motion.downY * ONE);
    const downZ = Math.round(motion.downZ * ONE);
    const turned = downX * this.checkedX + downY * this.checkedY + downZ * this.checkedZ < LOOK_AGAIN;
    // Down across the screen: how far the board leans from flat, and which
    // way (unit), for the snow on the ground.
    const across = Math.sqrt(motion.downX * motion.downX + motion.downY * motion.downY);
    const tilted = across > TILTED;
    const planeX = tilted ? Math.round((motion.downX / across) * ONE) : 0;
    const planeY = tilted ? Math.round((motion.downY / across) * ONE) : -ONE;
    // What the falling snow feels: gravity less the glass's own jolt.
    let pullX = motion.downX - motion.shakeX / STANDARD_GRAVITY;
    let pullY = motion.downY - motion.shakeY / STANDARD_GRAVITY;
    let pullZ = motion.downZ - motion.shakeZ / STANDARD_GRAVITY;
    const pull = Math.sqrt(pullX * pullX + pullY * pullY + pullZ * pullZ);
    if (pull > MAX_PULL) {
      pullX *= MAX_PULL / pull;
      pullY *= MAX_PULL / pull;
      pullZ *= MAX_PULL / pull;
    }
    // How hard the water is stirred, against each resting flake's grip, and
    // how high it throws the snow it lifts.
    const lift = water.reach * LIFT_SHARE;
    const blow = wind.gust * GUST_LIFT;
    this.sinceTurn = turned ? 0 : this.sinceTurn + dt;
    const wake = this.sinceTurn < LOOK_S || lift >= GRIP_LOW || blow >= GRIP_LOW;
    if (turned) {
      this.checkedX = downX;
      this.checkedY = downY;
      this.checkedZ = downZ;
    }
    this.frame++;
    this.move(
      Math.round(dt * ONE),
      Math.round(wanderKeep * ONE),
      wanderKick,
      downX,
      downY,
      downZ,
      planeX,
      planeY,
      Math.round(pullX * ONE),
      Math.round(pullY * ONE),
      Math.round(pullZ * ONE),
      Math.round(wind.speed * ONE),
      wake,
      Math.round(lift * ONE),
      Math.round(blow * ONE),
      this.frame & 3,
      water,
    );
  }

  private move(
    step: i32,
    keep: i32,
    kick: i32,
    downX: i32,
    downY: i32,
    downZ: i32,
    planeX: i32,
    planeY: i32,
    pullX: i32,
    pullY: i32,
    pullZ: i32,
    windX: i32,
    wake: boolean,
    lift: i32,
    blow: i32,
    quarter: number,
    water: Water,
  ) {
    const px = this.x;
    const py = this.y;
    const pz = this.z;
    const vx = this.vx;
    const vy = this.vy;
    const vz = this.vz;
    const wx = this.wanderX;
    const wy = this.wanderY;
    const wz = this.wanderZ;
    const fall = this.fall;
    const lag = this.lag;
    const follow = this.follow;
    const glide = this.glide;
    const heading = this.heading;
    const turn = this.turn;
    const rock = this.rock;
    const rockRate = this.rockRate;
    const sway = this.sway;
    const grip = this.grip;
    const restX = this.restX;
    const restY = this.restY;
    const restZ = this.restZ;
    const stick = this.stick;
    const hold = this.hold;
    const baked = this.baked;
    let letGo = false;
    const resting = this.resting;
    const ground = this.ground;
    const sine = SINE;
    const reciprocal = RECIPROCAL;
    const ramp = RAMP;
    const wall = water.wall;
    const core = water.core;
    const wallX: i32 = wall[0];
    const wallY: i32 = wall[1];
    const wallZ: i32 = wall[2];
    const coreX: i32 = core[0];
    const coreY: i32 = core[1];
    const coreZ: i32 = core[2];
    // This frame's whirlpools and eddy waves, as locals (see below).
    const blobs = water.blobCount;
    const blob = water.blob;
    const b0x: i32 = blob[0];
    const b0y: i32 = blob[1];
    const b0z: i32 = blob[2];
    const b0ax: i32 = blob[3];
    const b0ay: i32 = blob[4];
    const b0az: i32 = blob[5];
    const b0g: i32 = blob[6];
    const b0c: i32 = blob[7];
    const b1x: i32 = blob[8];
    const b1y: i32 = blob[9];
    const b1z: i32 = blob[10];
    const b1ax: i32 = blob[11];
    const b1ay: i32 = blob[12];
    const b1az: i32 = blob[13];
    const b1g: i32 = blob[14];
    const b1c: i32 = blob[15];
    const b2x: i32 = blob[16];
    const b2y: i32 = blob[17];
    const b2z: i32 = blob[18];
    const b2ax: i32 = blob[19];
    const b2ay: i32 = blob[20];
    const b2az: i32 = blob[21];
    const b2g: i32 = blob[22];
    const b2c: i32 = blob[23];
    const b3x: i32 = blob[24];
    const b3y: i32 = blob[25];
    const b3z: i32 = blob[26];
    const b3ax: i32 = blob[27];
    const b3ay: i32 = blob[28];
    const b3az: i32 = blob[29];
    const b3g: i32 = blob[30];
    const b3c: i32 = blob[31];
    const eddies = water.eddies > 0;
    const wave = water.wave;
    const w0x: i32 = wave[0];
    const w0y: i32 = wave[1];
    const w0z: i32 = wave[2];
    const w0p: i32 = wave[3];
    const f0x: i32 = wave[4];
    const f0y: i32 = wave[5];
    const f0z: i32 = wave[6];
    const w1x: i32 = wave[7];
    const w1y: i32 = wave[8];
    const w1z: i32 = wave[9];
    const w1p: i32 = wave[10];
    const f1x: i32 = wave[11];
    const f1y: i32 = wave[12];
    const f1z: i32 = wave[13];
    const w2x: i32 = wave[14];
    const w2y: i32 = wave[15];
    const w2z: i32 = wave[16];
    const w2p: i32 = wave[17];
    const f2x: i32 = wave[18];
    const f2y: i32 = wave[19];
    const f2z: i32 = wave[20];
    const w3x: i32 = wave[21];
    const w3y: i32 = wave[22];
    const w3z: i32 = wave[23];
    const w3p: i32 = wave[24];
    const f3x: i32 = wave[25];
    const f3y: i32 = wave[26];
    const f3z: i32 = wave[27];
    // Across down, in the screen's plane.
    const acrossX: i32 = -planeY;
    const acrossY: i32 = planeX;
    let seed: i32 = this.seed;

    for (let i = 0; i < FLAKES; i++) {
      let x: i32 = px[i];
      let y: i32 = py[i];
      let z: i32 = pz[i];

      const lying: i32 = resting[i];
      if (lying !== AFLOAT) {
        // Still. Freed when down turns past this flake's grip angle (on
        // the ground, only by tilting the board), or when the water is
        // stirred past its grip: then it comes back anywhere in the water,
        // so lifted snow never starts from one clump.
        if (!wake || (i & 3) !== quarter) continue;

        const facing: i32 =
          lying === ON_GROUND
            ? (planeX * restX[i] + planeY * restY[i]) >> SHIFT
            : (downX * restX[i] + downY * restY[i] + downZ * restZ[i]) >> SHIFT;
        const turned = facing < stick[i];
        const blown = lying === ON_GROUND && blow >= grip[i] && lift < grip[i];
        const stirred = lift >= grip[i];
        if (!turned && !stirred && !blown) continue;

        resting[i] = AFLOAT;
        if (baked[i] === 1) {
          baked[i] = 0;
          letGo = true;
        }
        vx[i] = 0;
        vy[i] = 0;
        vz[i] = 0;
        if (stirred || blown) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          x = (((seed & 2047) - 1024) * SCATTER) >> 10;
          z = ((((seed >> 11) & 2047) - 1024) * SCATTER) >> 10;
          // A gust's spray leaves from the side it blows from.
          if (blown && x > 0 === windX > 0) x = -x;
          const liftCol: i32 = Math.min(GRID - 1, Math.max(0, ((x + ONE) * GRID) >> (SHIFT + 1)));
          const liftRow: i32 = Math.min(GRID - 1, Math.max(0, ((z + ONE) * GRID) >> (SHIFT + 1)));
          const floor: i32 = ground[liftRow * GRID + liftCol] + CLEARANCE;
          // Stirred snow goes anywhere from the ground up to the glass
          // above it, evenly: a shake fills the whole globe. A gust only
          // sprays it low.
          const room: i32 = WALL_SQUARED - x * x - z * z;
          const top: i32 = room > 0 ? Math.sqrt(room) | 0 : floor;
          const height: i32 = blown ? SPRAY_RISE : top > floor ? top - floor : 0;
          y = floor + ((((seed >> 22) & 1023) * height) >> 10);
        } else if (lying === ON_GROUND) {
          y += CLEARANCE;
        }
      }

      // The water here. The spin blends from the core's at the centre to
      // the glass layer's at the glass.
      const r2: i32 = (x * x + y * y + z * z) >> SHIFT;
      const sx: i32 = coreX + (((wallX - coreX) * r2) >> SHIFT);
      const sy: i32 = coreY + (((wallY - coreY) * r2) >> SHIFT);
      const sz: i32 = coreZ + (((wallZ - coreZ) * r2) >> SHIFT);
      // The wind: a broad current across the globe, rolling back underneath.
      let ux: i32 = ((sy * z - sz * y + ((windX * y) >> 1)) >> SHIFT) + (windX >> 1);
      let uy: i32 = (sz * x - sx * z - ((windX * x) >> 1)) >> SHIFT;
      let uz: i32 = (sx * y - sy * x) >> SHIFT;
      // Whirlpools: Γ core² (axis × d) / (|d|² + core²)², which dies off
      // as 1/d³, so each stays a local swirl and none drags the whole
      // globe's water one way. Written out per whirlpool and per wave: a
      // loop here costs more to set up, every flake, than its work.
      if (blobs > 0) {
        const dx: i32 = x - b0x;
        const dy: i32 = y - b0y;
        const dz: i32 = z - b0z;
        const inverse: i32 = reciprocal[((((dx * dx + dy * dy + dz * dz) >> SHIFT) + b0c) >> 4) & 1023];
        const pull: i32 = (((b0g * inverse) >> SHIFT) * inverse) >> SHIFT;
        ux += (((b0ay * dz - b0az * dy) >> SHIFT) * pull) >> SHIFT;
        uy += (((b0az * dx - b0ax * dz) >> SHIFT) * pull) >> SHIFT;
        uz += (((b0ax * dy - b0ay * dx) >> SHIFT) * pull) >> SHIFT;
      }
      if (blobs > 1) {
        const dx: i32 = x - b1x;
        const dy: i32 = y - b1y;
        const dz: i32 = z - b1z;
        const inverse: i32 = reciprocal[((((dx * dx + dy * dy + dz * dz) >> SHIFT) + b1c) >> 4) & 1023];
        const pull: i32 = (((b1g * inverse) >> SHIFT) * inverse) >> SHIFT;
        ux += (((b1ay * dz - b1az * dy) >> SHIFT) * pull) >> SHIFT;
        uy += (((b1az * dx - b1ax * dz) >> SHIFT) * pull) >> SHIFT;
        uz += (((b1ax * dy - b1ay * dx) >> SHIFT) * pull) >> SHIFT;
      }
      if (blobs > 2) {
        const dx: i32 = x - b2x;
        const dy: i32 = y - b2y;
        const dz: i32 = z - b2z;
        const inverse: i32 = reciprocal[((((dx * dx + dy * dy + dz * dz) >> SHIFT) + b2c) >> 4) & 1023];
        const pull: i32 = (((b2g * inverse) >> SHIFT) * inverse) >> SHIFT;
        ux += (((b2ay * dz - b2az * dy) >> SHIFT) * pull) >> SHIFT;
        uy += (((b2az * dx - b2ax * dz) >> SHIFT) * pull) >> SHIFT;
        uz += (((b2ax * dy - b2ay * dx) >> SHIFT) * pull) >> SHIFT;
      }
      if (blobs > 3) {
        const dx: i32 = x - b3x;
        const dy: i32 = y - b3y;
        const dz: i32 = z - b3z;
        const inverse: i32 = reciprocal[((((dx * dx + dy * dy + dz * dz) >> SHIFT) + b3c) >> 4) & 1023];
        const pull: i32 = (((b3g * inverse) >> SHIFT) * inverse) >> SHIFT;
        ux += (((b3ay * dz - b3az * dy) >> SHIFT) * pull) >> SHIFT;
        uy += (((b3az * dx - b3ax * dz) >> SHIFT) * pull) >> SHIFT;
        uz += (((b3ax * dy - b3ay * dx) >> SHIFT) * pull) >> SHIFT;
      }
      // Eddy waves, each flowing across its own wavevector.
      if (eddies) {
        const c0: i32 = sine[(((w0x * x + w0y * y + w0z * z) >> SHIFT) + w0p + 256) & 1023];
        ux += (f0x * c0) >> SHIFT;
        uy += (f0y * c0) >> SHIFT;
        uz += (f0z * c0) >> SHIFT;
        const c1: i32 = sine[(((w1x * x + w1y * y + w1z * z) >> SHIFT) + w1p + 256) & 1023];
        ux += (f1x * c1) >> SHIFT;
        uy += (f1y * c1) >> SHIFT;
        uz += (f1z * c1) >> SHIFT;
        const c2: i32 = sine[(((w2x * x + w2y * y + w2z * z) >> SHIFT) + w2p + 256) & 1023];
        ux += (f2x * c2) >> SHIFT;
        uy += (f2y * c2) >> SHIFT;
        uz += (f2z * c2) >> SHIFT;
        const c3: i32 = sine[(((w3x * x + w3y * y + w3z * z) >> SHIFT) + w3p + 256) & 1023];
        ux += (f3x * c3) >> SHIFT;
        uy += (f3y * c3) >> SHIFT;
        uz += (f3z * c3) >> SHIFT;
      }
      // The water cannot flow into the ground or the roofs: its downward
      // part fades out over the last FLOOR_RAMP above them.
      const col: i32 = Math.min(GRID - 1, Math.max(0, ((x + ONE) * GRID) >> (SHIFT + 1)));
      const row: i32 = Math.min(GRID - 1, Math.max(0, ((z + ONE) * GRID) >> (SHIFT + 1)));
      const above: i32 = y - ground[row * GRID + col];
      if (uy < 0 && above < FLOOR_RAMP) uy = (uy * Math.max(0, above)) >> FLOOR_RAMP_SHIFT;
      // Near the glass the water slides along it rather than into it.
      if (r2 > RAMP_START) {
        const out: i32 = (ux * x + uy * y + uz * z) >> SHIFT;
        if (out > 0) {
          const cut: i32 = (out * ramp[(r2 >> 4) & 255]) >> SHIFT;
          ux -= (x * cut) >> SHIFT;
          uy -= (y * cut) >> SHIFT;
          uz -= (z * cut) >> SHIFT;
        }
      }

      // A random walk on top of the water.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const walkX: i32 = ((wx[i] * keep) >> SHIFT) + ((((seed & 1023) - 512) * kick) >> 9);
      const walkY: i32 = ((wy[i] * keep) >> SHIFT) + (((((seed >> 10) & 1023) - 512) * kick) >> 9);
      const walkZ: i32 = ((wz[i] * keep) >> SHIFT) + (((((seed >> 20) & 1023) - 512) * kick) >> 9);
      wx[i] = walkX;
      wy[i] = walkY;
      wz[i] = walkZ;

      // Its own fall: down along scene-down (fastest mid-rock), a glide
      // sideways on its tilt (turning, for the spirallers) and a rock.
      const c: i32 = sine[((rock[i] >> 8) + 256) & 1023];
      const sink: i32 = (fall[i] * (3277 + ((1638 * ((c * c) >> SHIFT)) >> SHIFT))) >> SHIFT;
      const swing: i32 = (sway[i] * c) >> SHIFT;
      const face: i32 = heading[i] >> 8;
      const glideAcross: i32 = (glide[i] * sine[(face + 256) & 1023]) >> SHIFT;
      const glideDepth: i32 = (glide[i] * sine[face & 1023]) >> SHIFT;
      rock[i] = (rock[i] + ((rockRate[i] * step) >> SHIFT)) & 0x3ffff;
      heading[i] = (heading[i] + ((turn[i] * step) >> SHIFT)) & 0x3ffff;
      const side: i32 = glideAcross + swing;
      const tx: i32 = ux + walkX + ((sink * pullX + side * acrossX) >> SHIFT);
      const ty: i32 = uy + walkY + ((sink * pullY + side * acrossY) >> SHIFT);
      const tz: i32 = uz + walkZ + glideDepth + ((sink * pullZ) >> SHIFT);

      // It follows that, lagging by its own time.
      const k: i32 = follow[lag[i]];
      let ax: i32 = vx[i] + (((tx - vx[i]) * k) >> SHIFT);
      let ay: i32 = vy[i] + (((ty - vy[i]) * k) >> SHIFT);
      let az: i32 = vz[i] + (((tz - vz[i]) * k) >> SHIFT);
      const fromX: i32 = x;
      const fromY: i32 = y;
      const fromZ: i32 = z;
      x += (ax * step) >> SHIFT;
      y += (ay * step) >> SHIFT;
      z += (az * step) >> SHIFT;
      let lands = AFLOAT;

      // The glass: slide along it, never bounce; level glass holds it.
      const out2: i32 = x * x + y * y + z * z;
      if (out2 > WALL_SQUARED) {
        const r: i32 = Math.max(1, Math.sqrt(out2) | 0);
        const nx: i32 = Math.trunc((x * ONE) / r);
        const ny: i32 = Math.trunc((y * ONE) / r);
        const nz: i32 = Math.trunc((z * ONE) / r);
        x = (nx * WALL) >> SHIFT;
        y = (ny * WALL) >> SHIFT;
        z = (nz * WALL) >> SHIFT;
        const away: i32 = ((ax >> 4) * nx + (ay >> 4) * ny + (az >> 4) * nz) >> (SHIFT - 4);
        if (away > 0) {
          ax = ((ax - ((away * nx) >> SHIFT)) * FRICTION) >> SHIFT;
          ay = ((ay - ((away * ny) >> SHIFT)) * FRICTION) >> SHIFT;
          az = ((az - ((away * nz) >> SHIFT)) * FRICTION) >> SHIFT;
        }
        if ((nx * downX + ny * downY + nz * downZ) >> SHIFT > hold[i]) lands = ON_GLASS;
      }
      // Only where the water is slow enough to let it settle.
      const settles = Math.abs(ux) + Math.abs(uy) + Math.abs(uz) < SETTLE_SPEED;

      // The ground and what stands on it: land from above, stop against a
      // side.
      const toCol: i32 = Math.min(GRID - 1, Math.max(0, ((x + ONE) * GRID) >> (SHIFT + 1)));
      const toRow: i32 = Math.min(GRID - 1, Math.max(0, ((z + ONE) * GRID) >> (SHIFT + 1)));
      const floor: i32 = ground[toRow * GRID + toCol];
      if (y < floor) {
        if (fromY >= floor - 120) {
          y = floor;
          // It lies there only while the ground slopes less than its grip
          // angle; steeper, it slides on.
          if (-planeY > stick[i]) lands = ON_GROUND;
          if (ay < 0) ay = 0;
        } else {
          // Stopped against a side: back to where it was, which was clear.
          x = fromX;
          z = fromZ;
          y = Math.max(y, fromY);
          ax = 0;
          az = 0;
        }
      }

      px[i] = x;
      py[i] = y;
      pz[i] = z;
      if (lands !== AFLOAT && settles) {
        // It stops dead.
        resting[i] = lands;
        restX[i] = lands === ON_GROUND ? planeX : downX;
        restY[i] = lands === ON_GROUND ? planeY : downY;
        restZ[i] = lands === ON_GROUND ? 0 : downZ;
        ax = 0;
        ay = 0;
        az = 0;
      }
      vx[i] = ax;
      vy[i] = ay;
      vz[i] = az;
    }
    this.seed = seed;
    if (letGo) this.unbaked = true;
  }

  draw(painter: Painter, dt: number) {
    if (this.unbaked) {
      painter.resettle();
      this.baked.fill(0);
      this.unbaked = false;
      this.resettled = true;
    }
    const baked = this.baked;
    const bakeId = this.bakeId;
    const bakeX = this.bakeX;
    const bakeY = this.bakeY;
    const bakeLight = this.bakeLight;
    const bakeFlake = this.bakeFlake;
    let baking = 0;
    const sprites = this.sprites;
    const chips = this.chips;
    const px = this.x;
    const py = this.y;
    const pz = this.z;
    const size = this.size;
    const shade = this.shade;
    const glint = this.glint;
    const glintRate = this.glintRate;
    const glitter = this.glitter;
    const resting = this.resting;
    const limits = CLASS_LIMITS;
    const bigId = this.bigId;
    const bigX = this.bigX;
    const bigY = this.bigY;
    const bigLight = this.bigLight;
    let big = 0;
    const depthScale = DEPTH_SCALE;
    const sine = SINE;
    const depth = painter.depth;
    const pixels = painter.pixels;
    const points = painter.points;
    let dots: i32 = painter.pointCount;
    const chipList = painter.chips;
    let small: i32 = painter.chipCount;
    const step: i32 = Math.round(dt * ONE);

    for (let i = 0; i < FLAKES; i++) {
      const lying: i32 = resting[i];
      if (lying === ON_GROUND || baked[i] === 1) continue;

      const z: i32 = pz[i];
      const scale: i32 = depthScale[((z + ONE) >> 5) & 255];
      const sx: i32 = CENTRE_X16 + ((((px[i] * scale) >> SHIFT) * RADIUS_X16) >> SHIFT);
      const along: i32 = (py[i] * COS - z * SIN) >> SHIFT;
      const sy: i32 = CENTRE_Y16 - ((((along * scale) >> SHIFT) * RADIUS_Y16) >> SHIFT);
      const cx: i32 = sx >> 4;
      const cy: i32 = sy >> 4;
      if (cx < 1 || cy < 1 || cx >= WIDTH - 2 || cy >= HEIGHT - 2 || depth[cy * WIDTH + cx] > (z * 100) >> SHIFT)
        continue;

      // Nearer is bigger; past NEAR it is out of focus, so bigger still,
      // softer and dimmer. Far flakes fade into the water.
      let radius: i32 = (size[i] * scale) >> SHIFT;
      let light: i32 = shade[i];
      if (z > NEAR) {
        radius += ((z - NEAR) * 870) >> SHIFT;
        light = (light * (ONE - (((z - NEAR) * 2500) >> SHIFT))) >> SHIFT;
      } else if (z < 0) {
        light = (light * (ONE + (z >> 1))) >> SHIFT;
      }
      // Turning in the water: a matte flake shimmers, dimmer edge-on;
      // glitter flashes as it catches the light.
      // Snow at rest stops turning (and so stops flickering).
      const turnTo: i32 = resting[i] === AFLOAT ? (glint[i] + ((glintRate[i] * step) >> SHIFT)) & 0x3ffff : glint[i];
      glint[i] = turnTo;
      const facing: i32 = sine[(turnTo >> 8) & 1023];
      if (glitter[i] === 1) {
        const flash: i32 = facing > 3800 ? (facing - 3800) * 12 : 0;
        const lit: i32 = ((light * 115) >> 8) + (flash >> 4);
        light = lit > 256 ? 256 : lit;
      } else {
        const square: i32 = facing < 0 ? -facing : facing;
        light = (light * (2867 + ((1229 * square) >> SHIFT))) >> SHIFT;
      }

      // Come to rest on the glass: baked into the settled picture after
      // this loop, and not drawn again while it lies there.
      if (lying === ON_GLASS) {
        const flat: i32 = (facing < 0 ? -facing : facing) >> 10;
        const grade: i32 =
          radius >= limits[4] ? 4 : radius >= limits[3] ? 3 : radius >= limits[2] ? 2 : radius >= limits[1] ? 1 : 0;
        const turnedTo: i32 = flat > 3 ? 3 : flat;
        bakeId[baking] = chips[((grade << 1) + (i & 1)) * 4 + turnedTo];
        bakeX[baking] = sx;
        bakeY[baking] = sy;
        bakeLight[baking] = light;
        bakeFlake[baking] = i;
        baking++;
        continue;
      }

      if (radius < limits[0]) {
        // A dot: spread over 2 x 2 pixels by where it falls between them,
        // drawn here, as a call per dot would cost more than the dot.
        const left: i32 = (sx - 8) >> 4;
        const top: i32 = (sy - 8) >> 4;
        const u: i32 = (sx - 8) & 15;
        const v: i32 = (sy - 8) & 15;
        const p: i32 = top * WIDTH + left;
        const target = pixels;
        const a00raw: i32 = (light * (16 - u) * (16 - v) * DOT_GAIN) >> 16;
        const a00: i32 = a00raw > 32 ? 32 : a00raw;
        const a01raw: i32 = (light * u * (16 - v) * DOT_GAIN) >> 16;
        const a01: i32 = a01raw > 32 ? 32 : a01raw;
        const a10raw: i32 = (light * (16 - u) * v * DOT_GAIN) >> 16;
        const a10: i32 = a10raw > 32 ? 32 : a10raw;
        const a11raw: i32 = (light * u * v * DOT_GAIN) >> 16;
        const a11: i32 = a11raw > 32 ? 32 : a11raw;
        const o00: i32 = target[p];
        const o01: i32 = target[p + 1];
        const o10: i32 = target[p + WIDTH];
        const o11: i32 = target[p + WIDTH + 1];
        const s00: i32 = (o00 | (o00 << 16)) & SPREAD;
        const s01: i32 = (o01 | (o01 << 16)) & SPREAD;
        const s10: i32 = (o10 | (o10 << 16)) & SPREAD;
        const s11: i32 = (o11 | (o11 << 16)) & SPREAD;
        const m00: i32 = ((s00 * (32 - a00) + SNOW * a00) >>> 5) & SPREAD;
        const m01: i32 = ((s01 * (32 - a01) + SNOW * a01) >>> 5) & SPREAD;
        const m10: i32 = ((s10 * (32 - a10) + SNOW * a10) >>> 5) & SPREAD;
        const m11: i32 = ((s11 * (32 - a11) + SNOW * a11) >>> 5) & SPREAD;
        target[p] = m00 | (m00 >>> 16);
        target[p + 1] = m01 | (m01 >>> 16);
        target[p + WIDTH] = m10 | (m10 >>> 16);
        target[p + WIDTH + 1] = m11 | (m11 >>> 16);
        if (dots < MAX_DOTS) points[dots++] = p;
        continue;
      }

      // A small chip: 2 x 2 px face-on, 2 x 1 edge-on (across or down by
      // its orientation), at its sub-pixel place over 3 x 3 pixels, drawn
      // here unrolled: a sprite's loops cost more than the chip.
      // Integer comparisons here, not Math.min/abs: those run as soft
      // doubles on this chip, and this loop runs for every flake.
      const turned: i32 = (facing < 0 ? -facing : facing) >> 10;
      const tumble: i32 = turned > 3 ? 3 : turned;
      if (radius < limits[3]) {
        const bx: i32 = sx - 16;
        const by: i32 = sy - 16;
        const u: i32 = bx & 15;
        const v: i32 = by & 15;
        const wide = tumble >= 2 || (i & 1) === 0;
        const tall = tumble >= 2 || (i & 1) === 1;
        const x0: i32 = wide ? 16 - u : u < 8 ? 8 - u : 0;
        const x1: i32 = wide ? 16 : u < 8 ? 8 + u : 24 - u;
        const x2: i32 = wide ? u : u < 8 ? 0 : u - 8;
        const y0: i32 = tall ? 16 - v : v < 8 ? 8 - v : 0;
        const y1: i32 = tall ? 16 : v < 8 ? 8 + v : 24 - v;
        const y2: i32 = tall ? v : v < 8 ? 0 : v - 8;
        const p: i32 = (by >> 4) * WIDTH + (bx >> 4);
        const a0raw: i32 = (light * x0 * y0) >> 11;
        const a0: i32 = a0raw > 32 ? 32 : a0raw;
        if (a0 > 0) {
          const o0: i32 = pixels[p];
          const s0: i32 = (o0 | (o0 << 16)) & SPREAD;
          const m0: i32 = ((s0 * (32 - a0) + SNOW * a0) >>> 5) & SPREAD;
          pixels[p] = m0 | (m0 >>> 16);
        }
        const a1raw: i32 = (light * x1 * y0) >> 11;
        const a1: i32 = a1raw > 32 ? 32 : a1raw;
        if (a1 > 0) {
          const o1: i32 = pixels[p + 1];
          const s1: i32 = (o1 | (o1 << 16)) & SPREAD;
          const m1: i32 = ((s1 * (32 - a1) + SNOW * a1) >>> 5) & SPREAD;
          pixels[p + 1] = m1 | (m1 >>> 16);
        }
        const a2raw: i32 = (light * x2 * y0) >> 11;
        const a2: i32 = a2raw > 32 ? 32 : a2raw;
        if (a2 > 0) {
          const o2: i32 = pixels[p + 2];
          const s2: i32 = (o2 | (o2 << 16)) & SPREAD;
          const m2: i32 = ((s2 * (32 - a2) + SNOW * a2) >>> 5) & SPREAD;
          pixels[p + 2] = m2 | (m2 >>> 16);
        }
        const a3raw: i32 = (light * x0 * y1) >> 11;
        const a3: i32 = a3raw > 32 ? 32 : a3raw;
        if (a3 > 0) {
          const o3: i32 = pixels[p + WIDTH];
          const s3: i32 = (o3 | (o3 << 16)) & SPREAD;
          const m3: i32 = ((s3 * (32 - a3) + SNOW * a3) >>> 5) & SPREAD;
          pixels[p + WIDTH] = m3 | (m3 >>> 16);
        }
        const a4raw: i32 = (light * x1 * y1) >> 11;
        const a4: i32 = a4raw > 32 ? 32 : a4raw;
        if (a4 > 0) {
          const o4: i32 = pixels[p + WIDTH + 1];
          const s4: i32 = (o4 | (o4 << 16)) & SPREAD;
          const m4: i32 = ((s4 * (32 - a4) + SNOW * a4) >>> 5) & SPREAD;
          pixels[p + WIDTH + 1] = m4 | (m4 >>> 16);
        }
        const a5raw: i32 = (light * x2 * y1) >> 11;
        const a5: i32 = a5raw > 32 ? 32 : a5raw;
        if (a5 > 0) {
          const o5: i32 = pixels[p + WIDTH + 2];
          const s5: i32 = (o5 | (o5 << 16)) & SPREAD;
          const m5: i32 = ((s5 * (32 - a5) + SNOW * a5) >>> 5) & SPREAD;
          pixels[p + WIDTH + 2] = m5 | (m5 >>> 16);
        }
        const a6raw: i32 = (light * x0 * y2) >> 11;
        const a6: i32 = a6raw > 32 ? 32 : a6raw;
        if (a6 > 0) {
          const o6: i32 = pixels[p + WIDTH * 2];
          const s6: i32 = (o6 | (o6 << 16)) & SPREAD;
          const m6: i32 = ((s6 * (32 - a6) + SNOW * a6) >>> 5) & SPREAD;
          pixels[p + WIDTH * 2] = m6 | (m6 >>> 16);
        }
        const a7raw: i32 = (light * x1 * y2) >> 11;
        const a7: i32 = a7raw > 32 ? 32 : a7raw;
        if (a7 > 0) {
          const o7: i32 = pixels[p + WIDTH * 2 + 1];
          const s7: i32 = (o7 | (o7 << 16)) & SPREAD;
          const m7: i32 = ((s7 * (32 - a7) + SNOW * a7) >>> 5) & SPREAD;
          pixels[p + WIDTH * 2 + 1] = m7 | (m7 >>> 16);
        }
        const a8raw: i32 = (light * x2 * y2) >> 11;
        const a8: i32 = a8raw > 32 ? 32 : a8raw;
        if (a8 > 0) {
          const o8: i32 = pixels[p + WIDTH * 2 + 2];
          const s8: i32 = (o8 | (o8 << 16)) & SPREAD;
          const m8: i32 = ((s8 * (32 - a8) + SNOW * a8) >>> 5) & SPREAD;
          pixels[p + WIDTH * 2 + 2] = m8 | (m8 >>> 16);
        }
        if (small < MAX_DOTS) chipList[small++] = p;
        continue;
      }

      // A bigger chip, at its size, orientation and how far it has turned.
      const sizeClass: i32 = radius >= limits[4] ? 5 : 4;
      const id: i32 = chips[(((sizeClass - 1) << 1) + (i & 1)) * 4 + tumble];
      // Queued: a call in this loop would slow every flake's array access.
      if (big < MAX_BIG) {
        bigId[big] = id;
        bigX[big] = sx;
        bigY[big] = sy;
        bigLight[big] = light;
        big++;
      }
    }
    painter.pointCount = dots;
    painter.chipCount = small;

    const sizes = sprites.sizes;
    for (let b: i32 = 0; b < baking; b++) {
      const id: i32 = bakeId[b];
      const half: i32 = sizes[id] >> 1;
      const x: i32 = bakeX[b];
      const y: i32 = bakeY[b];
      const phaseX: i32 = (x >> 2) & (PHASES - 1);
      const phaseY: i32 = (y >> 2) & (PHASES - 1);
      painter.bake(sprites, id, phaseX, phaseY, (x >> 4) - half, (y >> 4) - half, SNOW, bakeLight[b]);
      painter.blend(sprites, id, phaseX, phaseY, (x >> 4) - half, (y >> 4) - half, SNOW, bakeLight[b]);
      baked[bakeFlake[b]] = 1;
    }
    for (let b: i32 = 0; b < big; b++) {
      const id: i32 = bigId[b];
      const half: i32 = sizes[id] >> 1;
      const x: i32 = bigX[b];
      const y: i32 = bigY[b];
      painter.blend(
        sprites,
        id,
        (x >> 2) & (PHASES - 1),
        (y >> 2) & (PHASES - 1),
        (x >> 4) - half,
        (y >> 4) - half,
        SNOW,
        bigLight[b],
      );
    }
  }
}

// The landing-grid cell under (x, z), Q12.
function cellOf(x: i32, z: i32): i32 {
  const col: i32 = Math.min(GRID - 1, Math.max(0, ((x + ONE) * GRID) >> (SHIFT + 1)));
  const row: i32 = Math.min(GRID - 1, Math.max(0, ((z + ONE) * GRID) >> (SHIFT + 1)));
  return row * GRID + col;
}

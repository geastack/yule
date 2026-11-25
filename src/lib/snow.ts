import { CENTRE_X, HEIGHT, random, SINE, WIDTH } from "./frame";
import type { Motion } from "./motion";
import { type Painter, Sprites } from "./painter";
import { type Scene, SNOW_LAYERS, snowDepth } from "./scene";
import type { Water } from "./water";
import type { Wind } from "./wind";

export const FLAKES: i32 = 300;
const SUBPIXEL: i32 = 256;
const SNOW: i32 = 0xef5c;
const SPRITE_RADII = [1.14, 1.38, 1.62, 2.35];
const SHAPE_FRAMES: i32 = 8;
const wave = new Int16Array(1024);
for (let i = 0; i < wave.length; i++) wave[i] = Math.round(SINE[i] * 256);

// The snow moves in screen pixels. The painted silhouette and a fixed
// foreground/background layer give it depth without projecting each flake.
export class Snow {
  private readonly x = new Int32Array(FLAKES);
  private readonly y = new Int32Array(FLAKES);
  private readonly vx = new Int32Array(FLAKES);
  private readonly vy = new Int32Array(FLAKES);
  private readonly fall = new Int32Array(FLAKES);
  private readonly drift = new Int32Array(FLAKES);
  private readonly layer = new Uint8Array(FLAKES);
  private readonly depth = new Int8Array(FLAKES);
  private landings = new Int16Array(0);
  private readonly grip = new Uint8Array(FLAKES);
  private readonly shape = new Int32Array(FLAKES);
  private readonly chip = new Int32Array(FLAKES);
  private readonly frames = new Int32Array(SPRITE_RADII.length * SHAPE_FRAMES);
  private shapeClock: i32 = 0;
  private readonly resting = new Uint8Array(FLAKES);
  private readonly baked = new Uint8Array(FLAKES);
  private readonly floorOffset = new Int32Array(FLAKES);
  private readonly sprites = new Sprites(true);
  private readonly movingIds = new Int32Array(FLAKES);
  private readonly movingX = new Int32Array(FLAKES);
  private readonly movingY = new Int32Array(FLAKES);
  private readonly settledIds = new Int32Array(FLAKES);
  private readonly settledX = new Int32Array(FLAKES);
  private readonly settledY = new Int32Array(FLAKES);
  private readonly left = new Int32Array(HEIGHT);
  private readonly right = new Int32Array(HEIGHT);
  private readonly top = new Int32Array(WIDTH);
  private readonly floor = new Int32Array(WIDTH);
  private unbaked = false;
  private lastLift = 0;
  private circulation = 0;
  private bakeDelay = 0;

  init() {
    for (let size = 0; size < SPRITE_RADII.length; size++) {
      for (let frame = 0; frame < SHAPE_FRAMES; frame++) {
        const angle = (frame * Math.PI) / SHAPE_FRAMES;
        const face = Math.abs(Math.cos(angle));
        const radius = SPRITE_RADII[size] * (0.93 + 0.13 * face);
        this.frames[size * SHAPE_FRAMES + frame] = this.sprites.addChip(radius, 0.7, 0.78 + 0.22 * face, angle, 0.13);
      }
    }
    for (let i = 0; i < FLAKES; i++) {
      this.shape[i] = Math.floor(random() * SPRITE_RADII.length) * SHAPE_FRAMES;
      this.chip[i] = this.frames[this.shape[i] + (i & (SHAPE_FRAMES - 1))];
      this.fall[i] = 23 + Math.floor(random() * 14);
      this.drift[i] = Math.floor(random() * 15) - 7;
      this.layer[i] = Math.floor(random() * SNOW_LAYERS);
      this.depth[i] = snowDepth(this.layer[i]);
      this.grip[i] = 14 + Math.floor(random() * 55);
      this.floorOffset[i] = Math.floor(random() * 18);
    }
  }

  spread(scene: Scene) {
    const glass = scene.glass;
    this.landings = scene.landings;
    this.top.fill(HEIGHT);
    this.floor.fill(-1);
    for (let y = 0; y < HEIGHT; y++) {
      let left = WIDTH;
      let right = -1;
      for (let x = 0; x < WIDTH; x++) {
        if (glass[y * WIDTH + x] >= 127) continue;
        if (left === WIDTH) left = x;
        right = x;
        if (this.top[x] === HEIGHT) this.top[x] = y;
        this.floor[x] = y;
      }
      this.left[y] = left;
      this.right[y] = right;
    }
    this.baked.fill(0);
    this.resting.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
    this.unbaked = false;
    this.lastLift = 0;
    this.circulation = 0;
    this.bakeDelay = 0;
    for (let i = 0; i < FLAKES; i++) {
      const x = Math.round(CENTRE_X + (random() - 0.5) * WIDTH * 0.68);
      const top = this.top[x] + 4;
      const bottom = this.floor[x] - 20;
      this.x[i] = x * SUBPIXEL;
      this.y[i] = Math.round((top + random() * (bottom - top)) * SUBPIXEL);
    }
  }

  step(dt: number, motion: Motion, water: Water, wind: Wind) {
    // Water gathers momentum over several strokes and keeps moving between them.
    this.bakeDelay = Math.max(0, this.bakeDelay - dt);
    const drive = Math.min(1, Math.max(0, motion.jolt - 0.6) / 5);
    this.circulation += (drive - this.circulation) * (1 - Math.exp(-dt / (drive > this.circulation ? 1.1 : 1.6)));
    const currentSpeed: i32 = Math.round(200 * this.circulation);
    const lift = Math.round(Math.min(1, Math.max(water.liftPulse, wind.gust * 0.2, this.circulation * 1.05)) * 256);
    if (lift > this.lastLift || (drive > 0.12 && currentSpeed > 20)) {
      const sweep = Math.max(-100, Math.min(100, -motion.shakeX * 38));
      this.launch(lift, sweep);
    }
    this.lastLift = lift;

    const tick: i32 = Math.max(1, Math.round(dt * 1000));
    this.shapeClock = (this.shapeClock + tick) & 4095;
    const lateral: i32 = Math.round(motion.downX * 42 + wind.speed * 22);
    // Water drag smoothly takes a kick back toward each flake's fall speed.
    const follow: i32 = Math.round((1 - Math.exp(-dt / 0.36)) * 4096);
    const sideFollow: i32 = Math.round((1 - Math.exp(-dt / 0.85)) * 4096);
    const verticalSpeed: i32 = Math.round(currentSpeed * 0.78);
    const risePerPixel: i32 = Math.round((currentSpeed * 0.48 * 256) / HEIGHT);
    const phase: i32 = this.shapeClock >> 2;
    const x = this.x;
    const y = this.y;
    const vx = this.vx;
    const vy = this.vy;
    const resting = this.resting;
    const drift = this.drift;
    const fall = this.fall;
    const left = this.left;
    const right = this.right;
    const floor = this.floor;
    const floorOffset = this.floorOffset;
    const landings = this.landings;
    const layer = this.layer;
    // Convert px/s to Q8 px per frame using one frame-wide factor.
    const step: i32 = Math.round(dt * 65536);
    for (let i: i32 = 0; i < FLAKES; i++) {
      if (resting[i]) continue;
      let sx: i32 = x[i];
      let sy: i32 = y[i];
      const oldVx: i32 = vx[i];
      const oldVy: i32 = vy[i];
      const sway: i32 = (wave[(phase + i * 173) & 1023] * (22 + (i & 15)) + 128) >> 8;
      let flowX: i32 = 0;
      let flowY: i32 = 0;
      if (currentSpeed > 0) {
        const offset: i32 = phase + layer[i] * 83;
        flowX = (currentSpeed * wave[((sy >> 6) + offset) & 1023] + 128) >> 8;
        // Give the lower water more lift as shaking builds. Near the lid
        // the circulating current can still carry flakes back down.
        flowY = (verticalSpeed * wave[((sx >> 6) - offset) & 1023] - risePerPixel * (sy >> 8) + 128) >> 8;
      }
      const nextVx: i32 = oldVx + (((((drift[i] + lateral + sway + flowX) << 8) - oldVx) * sideFollow) >> 12);
      const nextVy: i32 = oldVy + (((((fall[i] + flowY) << 8) - oldVy) * follow) >> 12);
      sx += (((oldVx + nextVx) >> 4) * step) >> 13;
      sy += (((oldVy + nextVy) >> 4) * step) >> 13;
      vx[i] = nextVx;
      vy[i] = nextVy;
      const columnBefore: i32 = x[i] >> 8;
      const ceiling: i32 = (this.top[columnBefore] + 3) << 8;
      const hitTop = sy < ceiling;
      if (hitTop) sy = ceiling;
      const row: i32 = Math.max(0, Math.min(HEIGHT - 1, sy >> 8));
      const minX: i32 = (left[row] + 3) << 8;
      const maxX: i32 = (right[row] - 3) << 8;
      // At the tips of the glass a row can be empty or narrower than a flake.
      // Reject that move before using its projected x to sample the floor.
      if (minX > maxX) {
        this.rebound(i, 0, sy <= y[i] ? 1 : -1);
        continue;
      }
      const side: i32 = sx < minX ? 1 : sx > maxX ? -1 : 0;
      sx = Math.max(minX, Math.min(maxX, sx));
      const column: i32 = sx >> 8;
      const bottom: i32 = (floor[column] - floorOffset[i] - 4) << 8;
      const surface: i32 = (landings[layer[i] * WIDTH + column] - 1) << 8;
      if (side || hitTop || (sy >= bottom && y[i] > bottom && column !== columnBefore)) {
        const inward: i32 = side || (sy >= bottom && column !== columnBefore ? (column < columnBefore ? 1 : -1) : 0);
        this.rebound(i, inward, hitTop ? 1 : 0);
        if (sy >= bottom) continue;
      }
      if (surface <= bottom && y[i] <= surface && sy >= surface) {
        y[i] = surface;
        x[i] = sx;
        resting[i] = 2;
        continue;
      }
      if (sy >= bottom) {
        // Keep the old height if we drift into a shallower patch of the rim.
        sy = Math.max(y[i], bottom);
        resting[i] = 1;
      }
      x[i] = sx;
      y[i] = sy;
    }
  }

  // Reverse the wall-normal speed and scatter a little along the glass.
  private rebound(i: i32, inwardX: i32, inwardY: i32) {
    const vx = this.vx[i];
    const vy = this.vy[i];
    const impact = Math.max(12 * SUBPIXEL, inwardX ? Math.abs(vx) : 0, inwardY ? Math.abs(vy) : 0);
    const rebound = Math.min(240 * SUBPIXEL, Math.round(impact * (0.9 + random() * 0.2) + 4 * SUBPIXEL));
    const scatter = Math.round(impact * (random() - 0.5) * 0.64);
    this.vx[i] = inwardX ? inwardX * rebound : ((vx * 7) >> 3) + scatter;
    this.vy[i] = inwardY ? inwardY * rebound : ((vy * 7) >> 3) + scatter - (rebound >> 2);
  }

  // Each touch sample adds momentum to the nearby water. The existing drag
  // and fall integration carries that motion across frames and after release.
  stir(px: number, py: number, dx: number, dy: number) {
    // A return stroke can stir sideways. Gravity sets the downward speed.
    dy = Math.min(0, dy);
    if (dx === 0 && dy === 0) return;
    this.bakeDelay = 0.7;
    for (let i = 0; i < FLAKES; i++) {
      const rx = (this.x[i] >> 8) - px;
      const ry = (this.y[i] >> 8) - py;
      const weight = 1 - (rx * rx + ry * ry) / 40000;
      if (weight <= 0) continue;
      const gain = (3 + this.grip[i] / 45) * weight;
      // Water near the stroke follows the finger. Farther water curls back,
      // with the depth layer shifting where the return current starts.
      const current = SINE[(256 + Math.round(ry * 4) + this.layer[i] * 83) & 1023];
      const sideKick = dx * gain * (0.3 + current * 0.9);
      if (this.resting[i] && dy >= 0 && Math.abs(dx) * weight < 2) continue;
      if (this.resting[i]) {
        this.vx[i] = 0;
        this.vy[i] = 0;
        this.resting[i] = 0;
        if (this.baked[i]) this.unbaked = true;
      }
      this.vx[i] = Math.round(Math.max(-240 * SUBPIXEL, Math.min(240 * SUBPIXEL, this.vx[i] + sideKick * SUBPIXEL)));
      this.vy[i] = Math.round(Math.max(-900 * SUBPIXEL, Math.min(250 * SUBPIXEL, this.vy[i] + dy * gain * SUBPIXEL)));
    }
  }

  private launch(lift: i32, sweep: number) {
    if (lift > 14) this.bakeDelay = 0.7;
    for (let i = 0; i < FLAKES; i++) {
      if (this.grip[i] >= lift || !this.resting[i]) continue;
      const speed = (16 + Math.max(0, lift - this.grip[i]) * 1.1) * (0.78 + random() * 0.37);
      this.vy[i] = -Math.round(speed * SUBPIXEL);
      const current = SINE[((this.y[i] >> 6) + this.layer[i] * 83 + (this.shapeClock >> 2)) & 1023];
      const kick = sweep * (0.3 + 0.9 * current) + (random() - 0.5) * (14 + lift * 0.2);
      this.vx[i] = Math.round(Math.max(-240 * SUBPIXEL, Math.min(240 * SUBPIXEL, kick * SUBPIXEL)));
      this.resting[i] = 0;
      if (this.baked[i]) this.unbaked = true;
    }
  }

  restoreDeposits(painter: Painter): boolean {
    if (!this.unbaked) return false;
    painter.resettle();
    this.baked.fill(0);
    this.unbaked = false;
    return true;
  }

  draw(painter: Painter) {
    const baked = this.baked;
    const resting = this.resting;
    const x = this.x;
    const y = this.y;
    const chip = this.chip;
    const shape = this.shape;
    const frames = this.frames;
    const clock: i32 = this.shapeClock;
    const flakeDepth = this.depth;
    const depth = painter.depth;
    const movingIds = this.movingIds;
    const movingX = this.movingX;
    const movingY = this.movingY;
    const settledIds = this.settledIds;
    const settledX = this.settledX;
    const settledY = this.settledY;
    let moving: i32 = 0;
    let settled: i32 = 0;
    for (let i: i32 = 0; i < FLAKES; i++) {
      if (baked[i]) continue;
      const sx: i32 = x[i];
      const sy: i32 = y[i];
      const px: i32 = sx >> 8;
      const py: i32 = sy >> 8;
      if (px < 2 || py < 2 || px >= WIDTH - 2 || py >= HEIGHT - 2) continue;
      if (depth[py * WIDTH + px] > (resting[i] === 1 ? 110 : flakeDepth[i])) continue;
      if (resting[i] && this.bakeDelay === 0) {
        settledIds[settled] = chip[i];
        settledX[settled] = sx >> 4;
        settledY[settled] = sy >> 4;
        settled++;
        baked[i] = 1;
      } else {
        // Different phases and rates suggest tumbling without rotating geometry.
        const frame: i32 = (((clock * (3 + (i & 3))) >> 9) + i * 5) & (SHAPE_FRAMES - 1);
        const sprite: i32 = resting[i] ? chip[i] : frames[shape[i] + frame];
        chip[i] = sprite;
        movingIds[moving] = sprite;
        movingX[moving] = sx >> 4;
        movingY[moving] = sy >> 4;
        moving++;
      }
    }
    painter.stampBatch(this.sprites, settledIds, settledX, settledY, settled, SNOW, true);
    painter.stampBatch(this.sprites, movingIds, movingX, movingY, moving, SNOW, false);
  }
}

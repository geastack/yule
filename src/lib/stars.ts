import { CENTRE_X, CENTRE_Y, HEIGHT, PIXELS, RADIUS_X, RADIUS_Y, random, WIDTH } from "./frame";
import type { Painter } from "./painter";
import { Sprites } from "./painter";

// The open sky: inside the glass, nothing in front (scene.ts depth), above
// the treeline, and the night's dark blue.
const SKY_BOTTOM = 210; // frame row
const SKY_REACH = 0.9; // of the glass ellipse, squared
const BLUE_OVER_GREEN = 22;
const BLUE_LOW = 48;
const SKY_DARK = 330; // r + g + b below this
// A painted star: a bright point with open sky all round it.
const STAR_LIGHT = 280; // r + g + b
const MAX_STARS = 40;

// A shooting star every SHOOT_LOW_S-SHOOT_HIGH_S, never two at once: a bright
// head with a fading tail on a shallow slant across the open sky.
const SHOOT_LOW_S = 15;
const SHOOT_HIGH_S = 40;
const TAIL_SAMPLES = 20;
const FAINT_SHARE = 0.3; // some are fainter and shorter
const STREAK = [220, 232, 255];

// The sky's own light: the painted stars twinkle, and now and then a star
// shoots across, hidden behind anything in front and clipped to the glass.
export class Stars {
  readonly sky = new Uint8Array(PIXELS);
  private readonly sprites = new Sprites();
  private readonly starX = new Int32Array(MAX_STARS);
  private readonly starY = new Int32Array(MAX_STARS);
  private readonly starPhase = new Float64Array(MAX_STARS);
  private readonly starRate = new Float64Array(MAX_STARS);
  private starCount = 0;
  private twinkleId = 0;
  private streakId = 0;
  private headId = 0;
  private time = 0;
  // The shooting star: seconds into it (-1 when none), its life, start,
  // velocity (px/s), tail length (px) and brightness.
  private shootAt = -1;
  private life = 0;
  private fromX = 0;
  private fromY = 0;
  private speedX = 0;
  private speedY = 0;
  private tail = 0;
  private bright = 1;
  private untilShoot = 0;

  init() {
    this.twinkleId = this.sprites.addGlow(1.6);
    this.streakId = this.sprites.addGlow(1.9);
    this.headId = this.sprites.addGlow(2.8);
  }

  // The open sky and the painted stars of a globe's picture.
  load(backdrop: Uint16Array, depth: Int8Array) {
    this.sky.fill(0);
    this.starCount = 0;
    this.shootAt = -1;
    // Row by row, the span inside the reach of the glass, then the colours
    // in 32-bit integers (the switch to a new globe waits on this).
    const sky = this.sky;
    for (let y: i32 = 0; y < SKY_BOTTOM; y++) {
      const dy = (y - CENTRE_Y) / RADIUS_Y;
      const reach = SKY_REACH - dy * dy;
      if (reach <= 0) continue;

      const half = RADIUS_X * Math.sqrt(reach);
      const from: i32 = Math.max(0, Math.ceil(CENTRE_X - half));
      const to: i32 = Math.min(WIDTH, Math.floor(CENTRE_X + half));
      const row: i32 = y * WIDTH;
      for (let x: i32 = from; x < to; x++) {
        const p: i32 = row + x;
        const c: i32 = backdrop[p];
        const r: i32 = (c >> 11) << 3;
        const g: i32 = ((c >> 5) & 63) << 2;
        const b: i32 = (c & 31) << 3;
        const open = depth[p] === -128 && b - g >= BLUE_OVER_GREEN && b >= BLUE_LOW && r + g + b < SKY_DARK;
        sky[p] = open ? 1 : 0;
      }
    }
    this.findStars(backdrop);
    this.untilShoot = between(SHOOT_LOW_S, SHOOT_HIGH_S) * 0.5;
  }

  // A shooting star now, unless one is crossing (a dev trigger: long-press
  // the sky).
  shootNow() {
    if (this.shootAt < 0) this.shoot();
  }

  step(dt: number) {
    this.time += dt;
    this.untilShoot -= dt;
    if (this.untilShoot <= 0 && this.shootAt < 0) this.shoot();
    if (this.shootAt < 0) return;

    this.shootAt += dt;
    if (this.shootAt >= this.life) {
      this.shootAt = -1;
      this.untilShoot = between(SHOOT_LOW_S, SHOOT_HIGH_S);
    }
  }

  draw(painter: Painter) {
    const sprites = this.sprites;
    const half = sprites.sizes[this.twinkleId] >> 1;
    for (let i = 0; i < this.starCount; i++) {
      const wave = 0.5 + 0.5 * Math.sin(this.time * this.starRate[i] + this.starPhase[i]);
      const strength = Math.round((0.08 + 0.3 * wave * wave) * 256);
      painter.glow(sprites, this.twinkleId, this.starX[i] - half, this.starY[i] - half, 255, 250, 235, strength);
    }
    if (this.shootAt >= 0) this.drawStreak(painter);
  }

  // The head and its tail, each sample only where the sky is open.
  private drawStreak(painter: Painter) {
    const sprites = this.sprites;
    const half = sprites.sizes[this.streakId] >> 1;
    const t = this.shootAt;
    const fade = Math.min(1, t / (this.life * 0.15)) * Math.min(1, (this.life - t) / (this.life * 0.3));
    const headX = this.fromX + this.speedX * t;
    const headY = this.fromY + this.speedY * t;
    const speed = Math.sqrt(this.speedX * this.speedX + this.speedY * this.speedY);
    const backX = -this.speedX / speed;
    const backY = -this.speedY / speed;
    for (let k = 0; k < TAIL_SAMPLES; k++) {
      const along = (k / TAIL_SAMPLES) * Math.min(this.tail, speed * t);
      const x = Math.round(headX + backX * along);
      const y = Math.round(headY + backY * along);
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || this.sky[y * WIDTH + x] === 0) continue;

      const left = 1 - k / TAIL_SAMPLES;
      const strength = Math.round(fade * this.bright * left * 256);
      const id = k === 0 ? this.headId : this.streakId;
      const size = k === 0 ? sprites.sizes[this.headId] >> 1 : half;
      painter.glow(sprites, id, x - size, y - size, STREAK[0], STREAK[1], STREAK[2], strength);
    }
  }

  // A shallow slant across the upper sky, left or right.
  private shoot() {
    const faint = random() < FAINT_SHARE;
    const rightward = random() < 0.5;
    const angle = (10 + random() * 22) * (Math.PI / 180);
    const speed = 260 + random() * 120;
    this.life = faint ? 0.4 + random() * 0.15 : 0.55 + random() * 0.25;
    this.bright = faint ? 0.45 : 1;
    this.tail = faint ? 24 + random() * 12 : 40 + random() * 24;
    this.fromX = rightward ? CENTRE_X - 150 + random() * 120 : CENTRE_X + 150 - random() * 120;
    this.fromY = 25 + random() * 80;
    this.speedX = (rightward ? 1 : -1) * Math.cos(angle) * speed;
    this.speedY = Math.sin(angle) * speed;
    this.shootAt = 0;
  }

  // The painting's stars: bright points ringed by open sky.
  private findStars(backdrop: Uint16Array) {
    for (let y: i32 = 3; y < SKY_BOTTOM - 3; y++) {
      for (let x: i32 = 3; x < WIDTH - 3; x++) {
        const c: i32 = backdrop[y * WIDTH + x];
        const light: i32 = ((c >> 11) << 3) + (((c >> 5) & 63) << 2) + ((c & 31) << 3);
        if (light < STAR_LIGHT || !this.peak(backdrop, x, y, light) || !this.ringed(x, y)) continue;

        this.starX[this.starCount] = x;
        this.starY[this.starCount] = y;
        this.starPhase[this.starCount] = random() * Math.PI * 2;
        this.starRate[this.starCount] = 0.6 + random() * 1.6;
        this.starCount++;
        if (this.starCount >= MAX_STARS) return;
      }
    }
  }

  private peak(backdrop: Uint16Array, x: i32, y: i32, light: i32): boolean {
    for (let b: i32 = -1; b <= 1; b++) {
      for (let a: i32 = -1; a <= 1; a++) {
        const c: i32 = backdrop[(y + b) * WIDTH + x + a];
        const near: i32 = ((c >> 11) << 3) + (((c >> 5) & 63) << 2) + ((c & 31) << 3);
        if ((a !== 0 || b !== 0) && near >= light) return false;
      }
    }
    return true;
  }

  // Open sky all round, at 3 px: the square ring's 24 pixels.
  private ringed(x: i32, y: i32): boolean {
    const sky = this.sky;
    let open: i32 = 0;
    for (let k: i32 = -3; k <= 3; k++) {
      open += sky[(y - 3) * WIDTH + x + k] + sky[(y + 3) * WIDTH + x + k];
    }
    for (let k: i32 = -2; k <= 2; k++) {
      open += sky[(y + k) * WIDTH + x - 3] + sky[(y + k) * WIDTH + x + 3];
    }
    return open >= 22;
  }
}

function between(low: number, high: number): number {
  return low + random() * (high - low);
}

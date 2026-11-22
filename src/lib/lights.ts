import { WINDOW_X, WINDOW_Y } from "../data/backdrop";
import { BULB_STARTS, BULBS } from "../data/globes";
import { frameX, frameY, random, spread } from "./frame";
import { type Globe, MAX_WARM } from "./globes";
import type { Motion } from "./motion";
import type { Painter } from "./painter";
import { PHASES, Sprites } from "./painter";
import type { Sway } from "./sway";

const WARM_COLOUR = [255, 186, 100];
const DARK = spread(0x20e3); // (34, 28, 26): an unlit room
const DARKEST = 26; // of 32: how far an unlit window darkens
const MAX_BULBS = 48;
const MAX_LIGHT_RADIUS = 16; // px, of a warm light's glow
// The lamp's light pool on the snow, cooled as the lamp dips.
const POOL_RADIUS = 11;
const COLD_SNOW = spread(0x9539); // (150, 165, 200)

// The street lamp is steady; every LAMP_LOW_S-LAMP_HIGH_S it stutters like
// an old bulb: 2-4 quick dips, sometimes nearly off.
const LAMP_LOW_S = 20;
const LAMP_HIGH_S = 60;
const DIPS = 4;
// A fire behind some windows (±13%), and now and then (every
// WINDOW_OFF_LOW_S-WINDOW_OFF_HIGH_S) a light switched off for a while.
const FIRE = 0.13;
const WINDOW_OFF_LOW_S = 40;
const WINDOW_OFF_HIGH_S = 80;
const OFF_LOW_S = 2;
const OFF_HIGH_S = 5;

// The tree's bulbs change pattern every PATTERN_LOW_S-PATTERN_HIGH_S,
// crossfading over BLEND_S: twinkling, a chase, a slow fade together.
const BULB_RADIUS = 3;
const PATTERNS = 3;
const PATTERN_LOW_S = 20;
const PATTERN_HIGH_S = 30;
const BLEND_S = 1.5;

// The glass glint (source x, y) and how far it slides against a lean (px).
const GLINT_X = 290;
const GLINT_Y = 232;
const GLINT_SLIDE = 7;

// The globe's lights, alive: the bulbs twinkle in changing patterns, a fire
// flickers behind windows, a light goes off now and then, a street lamp
// stutters, and a glint on the glass slides against the lean.
export class Lights {
  private readonly sprites = new Sprites();
  private bulbs = 0;
  private readonly bulbX = new Int32Array(MAX_BULBS); // window px
  private readonly bulbY = new Int32Array(MAX_BULBS);
  private readonly bulbColour = new Int32Array(MAX_BULBS * 3);
  private readonly bulbPhase = new Float64Array(MAX_BULBS);
  private readonly bulbRate = new Float64Array(MAX_BULBS);
  private readonly bulbOrder = new Float64Array(MAX_BULBS); // 0..1 up the tree
  // Warm lights: source x, y, glow radius, strength each.
  private warmCount = 0;
  private readonly warm = new Float64Array(MAX_WARM * 4);
  private readonly warmIds = new Int32Array(MAX_WARM);
  private readonly lightIds = new Int32Array(MAX_LIGHT_RADIUS + 1); // by radius
  private readonly warmPhase = new Float64Array(MAX_WARM);
  private glassCount = 0;
  private readonly glass = new Int32Array(MAX_WARM * 4); // frame x, y, width, rows
  // How lit each warm light is (1 as painted).
  private readonly lit = new Float64Array(MAX_WARM);
  private windows = 0;
  private fireplaces = 0;
  private lamp = -1;
  private poolX = 0;
  private poolY = 0;
  // The lamp's dips: start, end (s into the stutter) and depth.
  private readonly dips = new Float64Array(DIPS * 3);
  private dipCount = 0;
  private stutterAt = -1; // seconds into the current stutter, -1 when steady
  private untilStutter = 0;
  private windowOff = -1;
  private offFor = 0;
  private offAt = 0;
  private untilOff = 0;
  private pattern = 0;
  private previous = 0;
  private patternAt = 0; // seconds since the pattern changed
  private untilPattern = 0;
  private time = 0;
  private bulbId = 0;
  private poolId = 0;
  private glintId = 0;
  private sparkleId = 0;
  private glintX = 0;
  private glintY = 0;

  // The glows every globe uses, made once: a globe's warm lights pick
  // theirs by radius.
  prepare() {
    const sprites = this.sprites;
    this.bulbId = sprites.addGlow(BULB_RADIUS);
    this.poolId = sprites.addDisc(POOL_RADIUS, POOL_RADIUS * 0.8);
    this.glintId = sprites.addGlow(11);
    this.sparkleId = sprites.addGlow(2.5);
    for (let r = 1; r <= MAX_LIGHT_RADIUS; r++) this.lightIds[r] = sprites.addLight(r);
  }

  // Globe number `index`'s lights.
  init(globe: Globe, index: number) {
    this.initBulbs(index);
    this.initWarm(globe);
    this.lamp = globe.lamp;
    this.windows = globe.windows;
    this.fireplaces = Math.min(globe.fireplaces, this.warmCount);
    this.glassCount = globe.glass.length / 4;
    for (let i = 0; i < this.glassCount; i++) {
      const left = Math.round(frameX(globe.glass[i * 4]));
      const top = Math.round(frameY(globe.glass[i * 4 + 1]));
      this.glass[i * 4] = left;
      this.glass[i * 4 + 1] = top;
      this.glass[i * 4 + 2] = Math.round(frameX(globe.glass[i * 4 + 2])) - left;
      this.glass[i * 4 + 3] = Math.round(frameY(globe.glass[i * 4 + 3])) - top;
    }
    const pooled = globe.pool.length > 0;
    this.poolX = pooled ? frameX(globe.pool[0]) : 0;
    this.poolY = pooled ? frameY(globe.pool[1]) : 0;
    this.stutterAt = -1;
    this.windowOff = -1;
    this.untilStutter = between(LAMP_LOW_S, LAMP_HIGH_S) * 0.5;
    this.untilOff = between(WINDOW_OFF_LOW_S, WINDOW_OFF_HIGH_S);
    this.untilPattern = between(PATTERN_LOW_S, PATTERN_HIGH_S);
  }

  private initBulbs(index: number) {
    const first = BULB_STARTS[index];
    this.bulbs = Math.min(MAX_BULBS, BULB_STARTS[index + 1] - first);
    let low = 1e9;
    let high = -1e9;
    for (let i = 0; i < this.bulbs; i++) {
      const at = (first + i) * 5;
      this.bulbX[i] = BULBS[at] - WINDOW_X;
      this.bulbY[i] = BULBS[at + 1] - WINDOW_Y;
      low = Math.min(low, this.bulbY[i]);
      high = Math.max(high, this.bulbY[i]);
      // Each bulb at full saturation, its hue kept.
      const r = BULBS[at + 2];
      const g = BULBS[at + 3];
      const b = BULBS[at + 4];
      const peak = Math.max(r, g, b, 1);
      this.bulbColour[i * 3] = Math.round((r * 255) / peak);
      this.bulbColour[i * 3 + 1] = Math.round((g * 255) / peak);
      this.bulbColour[i * 3 + 2] = Math.round((b * 255) / peak);
      this.bulbPhase[i] = random() * Math.PI * 2;
      this.bulbRate[i] = 0.8 + random() * 2.2;
    }
    for (let i = 0; i < this.bulbs; i++) this.bulbOrder[i] = (high - this.bulbY[i]) / Math.max(1, high - low);
  }

  // The globe's warm lights.
  private initWarm(globe: Globe) {
    let count = 0;
    for (let i = 0; i < globe.warm.length && count < MAX_WARM * 4; i++) this.warm[count++] = globe.warm[i];
    this.warmCount = count / 4;
    for (let i = 0; i < this.warmCount; i++) {
      const radius = Math.max(1, Math.min(MAX_LIGHT_RADIUS, Math.round(this.warm[i * 4 + 2])));
      this.warmIds[i] = this.lightIds[radius];
      this.warmPhase[i] = random() * Math.PI * 2;
      this.lit[i] = 1;
    }
  }

  // The lamp stutters now (a dev trigger: long-press the lamp).
  stutterNow() {
    if (this.lamp >= 0 && this.stutterAt < 0) this.stutter();
  }

  step(dt: number) {
    this.time += dt;
    this.stepLamp(dt);
    this.stepWindows(dt);
    this.patternAt += dt;
    this.untilPattern -= dt;
    if (this.untilPattern <= 0) {
      this.previous = this.pattern;
      this.pattern = (this.pattern + 1 + Math.floor(random() * (PATTERNS - 1))) % PATTERNS;
      this.patternAt = 0;
      this.untilPattern = between(PATTERN_LOW_S, PATTERN_HIGH_S);
    }
  }

  // Under the snow: the windows, the lamp's pool and the bulbs.
  drawBehind(painter: Painter, sway: Sway) {
    for (let i = 0; i < this.warmCount; i++) {
      if (i !== this.lamp) this.glowWarm(painter, i);
    }
    if (this.lamp >= 0) {
      this.dim(painter, this.lamp, this.glassCount - 1);
      this.pool(painter);
    }

    const sprites = this.sprites;
    const half = sprites.sizes[this.bulbId] >> 1;
    const blend = Math.min(1, this.patternAt / BLEND_S);
    for (let i = 0; i < this.bulbs; i++) {
      const glow = this.bulb(this.pattern, i) * blend + this.bulb(this.previous, i) * (1 - blend);
      const y = this.bulbY[i];
      const x = this.bulbX[i] + sway.treeShift(y) - half;
      const c = i * 3;
      const r = this.bulbColour[c];
      const strength = Math.round(glow * 256);
      painter.glow(sprites, this.bulbId, x, y - half, r, this.bulbColour[c + 1], this.bulbColour[c + 2], strength);
    }
  }

  // Over the snow: the lamp's halo (it lights the flakes passing it) and
  // the glint on the glass.
  drawFront(painter: Painter, motion: Motion, dt: number) {
    const sprites = this.sprites;
    if (this.lamp >= 0) this.glowWarm(painter, this.lamp);

    const follow = 1 - Math.exp(-dt / 0.3);
    this.glintX += (-motion.leanX * GLINT_SLIDE - this.glintX) * follow;
    this.glintY += (motion.leanY * GLINT_SLIDE - this.glintY) * follow;
    const glintHalf = sprites.sizes[this.glintId] >> 1;
    const x = Math.round(frameX(GLINT_X) + this.glintX);
    const y = Math.round(frameY(GLINT_Y) + this.glintY);
    painter.glow(sprites, this.glintId, x - glintHalf, y - glintHalf, 255, 255, 255, 46);
    const sparkleHalf = sprites.sizes[this.sparkleId] >> 1;
    const twinkle = Math.round((0.55 + 0.25 * Math.sin(this.time * 1.3)) * 256);
    painter.glow(sprites, this.sparkleId, x - 9 - sparkleHalf, y - 7 - sparkleHalf, 255, 255, 255, twinkle);
  }

  // A bulb's glow (0..1) in pattern `pattern`.
  private bulb(pattern: number, i: number): number {
    const t = this.time;
    if (pattern === 1) {
      // A chase climbing the tree.
      const wave = Math.max(0, Math.cos(t * 3 - this.bulbOrder[i] * 9));
      return 0.12 + 0.55 * wave * wave;
    }

    if (pattern === 2) {
      // All together, slowly in and out.
      const swell = 0.5 + 0.5 * Math.sin(t * 0.8);
      return 0.1 + 0.45 * swell;
    }

    // Each its own, with now and then a brief sparkle.
    const wave = Math.sin(t * this.bulbRate[i] + this.bulbPhase[i]);
    const sparkle = Math.max(0, Math.sin(t * 0.37 * this.bulbRate[i] + this.bulbPhase[i] * 3) - 0.92) * 6;
    return 0.28 + 0.24 * wave * wave + sparkle;
  }

  private stepLamp(dt: number) {
    if (this.lamp < 0) return;

    this.untilStutter -= dt;
    if (this.untilStutter <= 0 && this.stutterAt < 0) this.stutter();

    let lit = 1;
    if (this.stutterAt >= 0) {
      this.stutterAt += dt;
      let last = 0;
      for (let d = 0; d < this.dipCount; d++) {
        const at = d * 3;
        if (this.stutterAt >= this.dips[at] && this.stutterAt < this.dips[at + 1]) lit = 1 - this.dips[at + 2];
        last = this.dips[at + 1];
      }
      if (this.stutterAt > last) {
        this.stutterAt = -1;
        this.untilStutter = between(LAMP_LOW_S, LAMP_HIGH_S);
      }
    }
    this.lit[this.lamp] = lit;
  }

  // 2-4 quick dips, one maybe nearly off for ~100 ms.
  private stutter() {
    this.dipCount = 2 + Math.floor(random() * 3);
    let at = 0;
    for (let d = 0; d < this.dipCount; d++) {
      const deep = random() < 0.35;
      const length = deep ? 0.08 + random() * 0.05 : 0.04 + random() * 0.06;
      this.dips[d * 3] = at;
      this.dips[d * 3 + 1] = at + length;
      this.dips[d * 3 + 2] = deep ? 0.85 + random() * 0.12 : 0.3 + random() * 0.35;
      at += length + 0.05 + random() * 0.15;
    }
    this.stutterAt = 0;
  }

  private stepWindows(dt: number) {
    const t = this.time;
    for (let i = 0; i < this.warmCount; i++) {
      if (i === this.lamp) continue;

      let lit = 1;
      if (i < this.fireplaces) {
        const phase = this.warmPhase[i];
        const fire =
          0.55 * Math.sin(t * 1.3 + phase) + 0.3 * Math.sin(t * 3.1 + phase * 2) + 0.15 * Math.sin(t * 7.7 + phase * 3);
        lit += FIRE * fire;
      }
      this.lit[i] = lit;
    }
    if (this.windows === 0) return;

    this.untilOff -= dt;
    if (this.untilOff <= 0 && this.windowOff < 0) {
      this.windowOff = Math.floor(random() * this.windows);
      this.offAt = 0;
      this.offFor = between(OFF_LOW_S, OFF_HIGH_S);
    }
    if (this.windowOff >= 0) {
      // Off in a moment, back on a little slower.
      this.offAt += dt;
      const off = Math.min(1, this.offAt / 0.12) * Math.min(1, Math.max(0, (this.offFor - this.offAt) / 0.3));
      this.lit[this.windowOff] *= 1 - off;
      if (this.offAt >= this.offFor) {
        this.windowOff = -1;
        this.untilOff = between(WINDOW_OFF_LOW_S, WINDOW_OFF_HIGH_S);
      }
    }
  }

  // A warm light at its brightness: its glow, and its glass darkened below 1.
  private glowWarm(painter: Painter, i: number) {
    const sprites = this.sprites;
    const id = this.warmIds[i];
    const half = sprites.sizes[id] >> 1;
    const breath = 0.85 + 0.15 * Math.sin(this.time * 0.9 + this.warmPhase[i]);
    const strength = Math.round(this.warm[i * 4 + 3] * breath * Math.max(0, this.lit[i]) * 256);
    const x = Math.round(frameX(this.warm[i * 4])) - half;
    const y = Math.round(frameY(this.warm[i * 4 + 1])) - half;
    painter.glow(sprites, id, x, y, WARM_COLOUR[0], WARM_COLOUR[1], WARM_COLOUR[2], strength);
    if (i < this.windows) this.dim(painter, i, i);
  }

  private dim(painter: Painter, light: number, glass: number) {
    const lit = this.lit[light];
    if (lit >= 1 || glass < 0 || glass >= this.glassCount) return;

    const at = glass * 4;
    const alpha = Math.round((1 - Math.max(0, lit)) * DARKEST);
    painter.shade(this.glass[at], this.glass[at + 1], this.glass[at + 2], this.glass[at + 3], DARK, alpha);
  }

  // The lamp's pool on the snow cools as the lamp dips.
  private pool(painter: Painter) {
    const lit = this.lit[this.lamp];
    if (lit >= 1 || this.poolX === 0) return;

    const sprites = this.sprites;
    const half = sprites.sizes[this.poolId] >> 1;
    const x = Math.round(this.poolX) - half;
    const y = Math.round(this.poolY) - half;
    const strength = Math.round((1 - lit) * 0.5 * 256);
    painter.blend(sprites, this.poolId, PHASES >> 1, PHASES >> 1, x, y, COLD_SNOW, strength);
  }
}

function between(low: number, high: number): number {
  return low + random() * (high - low);
}

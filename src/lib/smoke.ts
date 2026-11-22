import {
  CENTRE_X,
  CENTRE_Y,
  frameX,
  frameY,
  heightAt,
  RADIUS_X,
  RADIUS_Y,
  random,
  spread,
  TILT_COS,
  TILT_SIN,
} from "./frame";
import type { Globe } from "./globes";
import type { Motion } from "./motion";
import { type Painter, PHASES, Sprites } from "./painter";
import type { Water } from "./water";
import type { Wind } from "./wind";

const PUFFS = 16;
const LIFE_S = 5;
const EVERY_S = LIFE_S / PUFFS;
const RISE = 0.11; // world units/s, against scene-down
const SPREAD_SPEED = 0.03; // sideways drift
const WIND_CARRY = 0.8; // smoke is light: the wind lays it nearly flat
// Puff sprites by radius (px), growing with age.
const RADII = [2, 3, 4, 5, 6, 7];
const STRENGTH = 0.5;
const SMOKE = spread(0xc61a); // (192, 192, 208)

// Wood smoke from the globe's chimney, if it has one: soft puffs that rise against scene-down,
// grow and fade, swirl with the water and lean with the wind (a gust lays
// them nearly flat).
export class Smoke {
  private readonly x = new Float64Array(PUFFS);
  private readonly y = new Float64Array(PUFFS);
  private readonly z = new Float64Array(PUFFS);
  private readonly driftX = new Float64Array(PUFFS);
  private readonly driftZ = new Float64Array(PUFFS);
  private readonly age = new Float64Array(PUFFS);
  private readonly sprites = new Sprites();
  private readonly ids = new Int32Array(RADII.length);
  private next = 0;
  private sinceSpawn = 0;
  // The chimney's top (frame x; world y, z), if the globe has one.
  private smoking = false;
  private chimneyX = 0;
  private chimneyY = 0;
  private chimneyZ = 0;

  init() {
    for (let i = 0; i < RADII.length; i++) this.ids[i] = this.sprites.addDisc(RADII[i] * 0.8, RADII[i]);
  }

  // The globe's chimney, and no smoke left from the last one.
  load(globe: Globe) {
    for (let i = 0; i < PUFFS; i++) this.age[i] = LIFE_S + 1;
    const chimney = globe.chimney;
    this.smoking = chimney.length > 0;
    if (!this.smoking) return;

    this.chimneyZ = chimney[2];
    this.chimneyX = (frameX(chimney[0]) - CENTRE_X) / RADIUS_X;
    this.chimneyY = heightAt(frameY(chimney[1]), this.chimneyZ);
  }

  step(dt: number, motion: Motion, water: Water, wind: Wind) {
    this.sinceSpawn += dt;
    if (this.smoking && this.sinceSpawn >= EVERY_S) {
      this.sinceSpawn = 0;
      this.spawn(this.next);
      this.next = (this.next + 1) % PUFFS;
    }

    // The water's spin up where the smoke is (relative to the glass).
    const wx = water.wall[0] / 4096;
    const wy = water.wall[1] / 4096;
    const wz = water.wall[2] / 4096;
    const riseX = -motion.downX * RISE + wind.speed * WIND_CARRY;
    const riseY = -motion.downY * RISE;
    for (let i = 0; i < PUFFS; i++) {
      if (this.age[i] > LIFE_S) continue;

      const x = this.x[i];
      const y = this.y[i];
      const z = this.z[i];
      // Carried by the swirl like the snow, rising, drifting apart.
      this.x[i] = x + (wy * z - wz * y + riseX + this.driftX[i]) * dt;
      this.y[i] = y + (wz * x - wx * z + riseY) * dt;
      this.z[i] = z + (wx * y - wy * x + this.driftZ[i]) * dt;
      this.age[i] += dt * (1 + water.eddies * 3);
      const reach = this.x[i] * this.x[i] + this.y[i] * this.y[i] + this.z[i] * this.z[i];
      if (reach > 0.9) this.age[i] = LIFE_S + 1; // gone into the glass
    }
  }

  draw(painter: Painter) {
    const sprites = this.sprites;
    for (let i = 0; i < PUFFS; i++) {
      const t = this.age[i] / LIFE_S;
      if (t >= 1) continue;

      const sx = CENTRE_X + this.x[i] * RADIUS_X;
      const sy = CENTRE_Y - (this.y[i] * TILT_COS - this.z[i] * TILT_SIN) * RADIUS_Y;
      const z = Math.round(this.z[i] * 100);
      if (painter.hidden(Math.floor(sx), Math.floor(sy), z)) continue;

      // Thick as it leaves the chimney, thinning as it spreads.
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t);
      const size = Math.min(RADII.length - 1, Math.floor(t * RADII.length));
      const id = this.ids[size];
      const half = sprites.sizes[id] >> 1;
      const left = Math.floor(sx);
      const top = Math.floor(sy);
      const phaseX = Math.floor((sx - left) * PHASES);
      const phaseY = Math.floor((sy - top) * PHASES);
      painter.blend(sprites, id, phaseX, phaseY, left - half, top - half, SMOKE, Math.round(fade * STRENGTH * 256));
    }
  }

  private spawn(i: number) {
    this.x[i] = this.chimneyX;
    this.z[i] = this.chimneyZ;
    this.y[i] = this.chimneyY;
    this.driftX[i] = (random() - 0.35) * SPREAD_SPEED;
    this.driftZ[i] = (random() - 0.5) * SPREAD_SPEED;
    this.age[i] = 0;
  }
}

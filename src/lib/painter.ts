import { HEIGHT, PIXELS, SPREAD, WIDTH } from "./frame";

// Hot loops here and in snow.ts are `i32` throughout: the compiler lowers
// them to 32-bit integer code, where plain numbers would be software doubles.

const MAX_MARKS = 4096;
const MAX_POINTS = 4096;
// Drawn pieces (a 3 x 3 chip counts twice) beyond which restoring the whole
// window at once is cheaper.
const BUSY = 900;
// Sub-pixel phases per axis a sprite is pre-rendered at.
export const PHASES = 4;

// Soft round sprites, pre-rendered at PHASES x PHASES sub-pixel offsets as
// 0..255 coverage, so a moving flake glides instead of stepping a pixel.
export class Sprites {
  readonly coverage = new Uint8Array(65536);
  readonly sizes = new Int32Array(64);
  // Where each sprite's phase (0, 0) starts in `coverage`.
  readonly offsets = new Int32Array(64);
  private used = 0;
  private count = 0;

  // A one-pixel dot spread over 2 x 2 pixels by its sub-pixel position.
  addPoint(): number {
    return this.add(0.5, 1, 2, false, PHASES);
  }

  // A disc of `radius` px whose edge fades over `soft` px; returns its id.
  addDisc(radius: number, soft: number): number {
    return this.add(radius, soft, Math.ceil(radius * 2 + soft) + 1, false, PHASES);
  }

  // A glow falling off smoothly to nothing at `radius` px; returns its id.
  addGlow(radius: number): number {
    return this.add(radius, 1, Math.ceil(radius * 2) + 1, true, PHASES);
  }

  // A glow at sub-pixel phase (0, 0) only, for lights that never move
  // (Painter.glow draws that phase): a sixteenth of the memory and time.
  addLight(radius: number): number {
    return this.add(radius, 1, Math.ceil(radius * 2) + 1, true, 1);
  }

  // A snow chip: a flat, slightly ragged flake of `radius` px seen at an
  // angle (`aspect` of its width across, 1 face-on), turned by `angle`
  // radians, its edge fading over `soft` px; returns its id.
  addChip(radius: number, soft: number, aspect: number, angle: number, ragged: number): number {
    const id = this.count;
    const size = Math.ceil(radius * 2 * (1 + ragged) + soft) + 1;
    this.sizes[id] = size;
    this.offsets[id] = this.used;
    const half = size >> 1;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let py = 0; py < PHASES; py++) {
      for (let px = 0; px < PHASES; px++) {
        const cx = half + (px + 0.5) / PHASES;
        const cy = half + (py + 0.5) / PHASES;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            // Into the chip's own frame, its narrow axis stretched back.
            const u = dx * cos + dy * sin;
            const v = (dy * cos - dx * sin) / aspect;
            const distance = Math.sqrt(u * u + v * v);
            const turn = Math.atan2(v, u);
            const reach = radius * (1 + ragged * (0.6 * Math.sin(3 * turn + angle * 5) + 0.4 * Math.sin(5 * turn)));
            // Squashed edge-on, its edge stays as soft as face-on.
            this.coverage[this.used++] = Math.round(edge((reach - distance) / (soft / Math.sqrt(aspect)) + 0.5) * 255);
          }
        }
      }
    }
    this.count++;
    return id;
  }

  private add(radius: number, soft: number, size: number, glow: boolean, phases: number): number {
    const id = this.count;
    this.sizes[id] = size;
    this.offsets[id] = this.used;
    const half = size >> 1;
    for (let py = 0; py < phases; py++) {
      for (let px = 0; px < phases; px++) {
        const cx = half + (px + 0.5) / PHASES;
        const cy = half + (py + 0.5) / PHASES;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const point = Math.min(1, 1.7 * Math.max(0, 1 - Math.abs(dx)) * Math.max(0, 1 - Math.abs(dy)));
            const disc = glow ? falloff(distance / radius) : edge((radius - distance) / soft + 0.5);
            const fill = size === 2 ? point : disc;
            this.coverage[this.used++] = Math.round(fill * 255);
          }
        }
      }
    }
    this.count++;
    return id;
  }
}

function edge(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

function falloff(t: number): number {
  if (t >= 1) return 0;

  const inside = 1 - t * t;
  return inside * inside * inside;
}

// Draws the live layers into the frame over the settled picture (the baked
// backdrop, with the swaying trees' rows shifted), and remembers every box it
// touched so the next frame puts back just those pixels instead of the whole
// picture.
export class Painter {
  readonly pixels: Uint16Array;
  readonly backdrop: Uint16Array;
  // The backdrop as it stands now (sway.ts shears rows of it): what the
  // frame restores to.
  readonly settled: Uint16Array;
  // Per pixel, the depth (z * 100) of whatever solid covers it; snow
  // behind it is hidden. -128 where nothing does.
  readonly depth: Int8Array;
  private readonly marks = new Int32Array(MAX_MARKS * 3);
  private markCount: i32 = 0;
  // 2 x 2 dots drawn this frame (frame index of their corner): lib/snow.ts
  // writes these itself, as a call per dot would cost more than the dot.
  readonly points = new Int32Array(MAX_POINTS);
  pointCount = 0;
  // 3 x 3 small chips drawn this frame, the same way.
  readonly chips = new Int32Array(MAX_POINTS);
  chipCount = 0;
  private everything = false; // the whole frame to restore next time

  constructor(pixels: Uint16Array, backdrop: Uint16Array, depth: Int8Array) {
    this.pixels = pixels;
    this.backdrop = backdrop;
    this.settled = new Uint16Array(backdrop.length);
    this.settled.set(backdrop);
    this.depth = depth;
  }

  // Blends sprite `id` into the settled picture itself (snow at rest on the
  // glass, drawn once), and marks its box so the frame picks it up.
  bake(sprites: Sprites, id: i32, px: i32, py: i32, x: i32, y: i32, colour: i32, strength: i32) {
    if (!this.claim(x, y, sprites.sizes[id], sprites.sizes[id])) return;

    this.blendInto(this.settled, sprites, id, px, py, x, y, colour, strength);
  }

  // The settled picture back to the bare backdrop (baked snow gone); the
  // whole frame is restored next time.
  resettle() {
    this.settled.set(this.backdrop);
    this.everything = true;
  }

  // A new globe's picture is in the backdrop: it becomes the settled
  // picture and the frame, with nothing left to restore.
  reload() {
    this.settled.set(this.backdrop);
    this.pixels.set(this.backdrop);
    this.pointCount = 0;
    this.chipCount = 0;
    this.markCount = 0;
  }

  // Puts the settled picture back wherever the last frame drew; after a
  // busy frame (snow everywhere), the whole window in one copy, which is
  // faster than thousands of scattered patches.
  restore() {
    const pixels = this.pixels;
    const backdrop = this.settled;
    if (this.everything || this.pointCount + this.chipCount * 2 + this.markCount > BUSY) {
      pixels.set(backdrop);
      this.everything = false;
      this.pointCount = 0;
      this.chipCount = 0;
      this.markCount = 0;
      return;
    }

    const points = this.points;
    // Plain counters: the compiler gives these loops unchecked array access.
    const dots = this.pointCount;
    for (let k = 0; k < dots; k++) {
      const p: i32 = points[k];
      pixels[p] = backdrop[p];
      pixels[p + 1] = backdrop[p + 1];
      pixels[p + WIDTH] = backdrop[p + WIDTH];
      pixels[p + WIDTH + 1] = backdrop[p + WIDTH + 1];
    }
    this.pointCount = 0;
    const chips = this.chips;
    const small = this.chipCount;
    for (let k = 0; k < small; k++) {
      const p: i32 = chips[k];
      const q: i32 = p + WIDTH;
      const r: i32 = q + WIDTH;
      pixels[p] = backdrop[p];
      pixels[p + 1] = backdrop[p + 1];
      pixels[p + 2] = backdrop[p + 2];
      pixels[q] = backdrop[q];
      pixels[q + 1] = backdrop[q + 1];
      pixels[q + 2] = backdrop[q + 2];
      pixels[r] = backdrop[r];
      pixels[r + 1] = backdrop[r + 1];
      pixels[r + 2] = backdrop[r + 2];
    }
    this.chipCount = 0;
    const marks = this.marks;
    const count: i32 = this.markCount * 3;
    for (let m: i32 = 0; m < count; m += 3) {
      const width: i32 = marks[m + 1];
      const rows: i32 = marks[m + 2];
      let row: i32 = marks[m];
      for (let y: i32 = 0; y < rows; y++) {
        for (let x: i32 = 0; x < width; x++) pixels[row + x] = backdrop[row + x];
        row += WIDTH;
      }
    }
    this.markCount = 0;
  }

  // Whether a solid in front of depth `z` (x 100) covers pixel (x, y).
  hidden(x: i32, y: i32, z: i32): boolean {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return true;

    return this.depth[y * WIDTH + x] > z;
  }

  // Blends sprite `id` at sub-pixel phase (px, py) over the frame with its
  // top-left at (x, y), towards `colour` (spread) at `strength` 0..256.
  blend(sprites: Sprites, id: i32, px: i32, py: i32, x: i32, y: i32, colour: i32, strength: i32) {
    if (!this.claim(x, y, sprites.sizes[id], sprites.sizes[id])) return;

    this.blendInto(this.pixels, sprites, id, px, py, x, y, colour, strength);
  }

  private blendInto(
    pixels: Uint16Array,
    sprites: Sprites,
    id: i32,
    px: i32,
    py: i32,
    x: i32,
    y: i32,
    colour: i32,
    strength: i32,
  ) {
    const size: i32 = sprites.sizes[id];
    const coverage = sprites.coverage;
    let at: i32 = sprites.offsets[id] + (py * PHASES + px) * size * size;
    let row: i32 = y * WIDTH + x;
    for (let j: i32 = 0; j < size; j++) {
      for (let i: i32 = 0; i < size; i++) {
        const alpha: i32 = (coverage[at + i] * strength) >> 11;
        const p: i32 = row + i;
        if (alpha > 0) {
          const old: i32 = pixels[p];
          const under: i32 = (old | (old << 16)) & SPREAD;
          const mixed: i32 = ((under * (32 - alpha) + colour * alpha) >>> 5) & SPREAD;
          pixels[p] = mixed | (mixed >>> 16);
        }
      }
      row += WIDTH;
      at += size;
    }
  }

  // Blends a width x rows box at (x, y) towards `colour` (spread) by
  // `alpha` 0..32: darkens a lit window or the lamp's glass.
  shade(x: i32, y: i32, width: i32, rows: i32, colour: i32, alpha: i32) {
    if (alpha <= 0 || !this.claim(x, y, width, rows)) return;

    const pixels = this.pixels;
    let row: i32 = y * WIDTH + x;
    for (let j: i32 = 0; j < rows; j++) {
      for (let i: i32 = 0; i < width; i++) {
        const p: i32 = row + i;
        const old: i32 = pixels[p];
        const under: i32 = (old | (old << 16)) & SPREAD;
        const mixed: i32 = ((under * (32 - alpha) + colour * alpha) >>> 5) & SPREAD;
        pixels[p] = mixed | (mixed >>> 16);
      }
      row += WIDTH;
    }
  }

  // Adds sprite `id` (phase 0) lit in (r, g, b) 0..255 at `strength` 0..256
  // to the frame with its top-left at (x, y): light, never hidden.
  glow(sprites: Sprites, id: i32, x: i32, y: i32, r: i32, g: i32, b: i32, strength: i32) {
    const size: i32 = sprites.sizes[id];
    if (!this.claim(x, y, size, size)) return;

    const pixels = this.pixels;
    const coverage = sprites.coverage;
    const at: i32 = sprites.offsets[id];
    let row: i32 = y * WIDTH + x;
    for (let j: i32 = 0; j < size; j++) {
      const line: i32 = at + j * size;
      for (let i: i32 = 0; i < size; i++) {
        const light: i32 = (coverage[line + i] * strength) >> 8;
        if (light > 0) {
          const p: i32 = row + i;
          const old: i32 = pixels[p];
          const red: i32 = Math.min(31, (old >> 11) + ((r * light) >> 11));
          const green: i32 = Math.min(63, ((old >> 5) & 63) + ((g * light) >> 10));
          const blue: i32 = Math.min(31, (old & 31) + ((b * light) >> 11));
          pixels[p] = (red << 11) | (green << 5) | blue;
        }
      }
      row += WIDTH;
    }
  }

  // Records a width x rows box at (x, y) for the next restore; false when
  // it would leave the frame or the record is full.
  claim(x: i32, y: i32, width: i32, rows: i32): boolean {
    if (x < 0 || y < 0 || x + width > WIDTH || y + rows > HEIGHT || this.markCount >= MAX_MARKS) return false;

    const m: i32 = this.markCount * 3;
    this.marks[m] = y * WIDTH + x;
    this.marks[m + 1] = width;
    this.marks[m + 2] = rows;
    this.markCount++;
    return true;
  }
}

// Decodes the baked backdrop (base64 little-endian RGB565 words).
export function decodeBackdrop(text: string, out: Uint16Array) {
  const values = new Int32Array(128);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < 64; i++) values[alphabet.charCodeAt(i)] = i;

  const bytes = new Uint8Array(PIXELS * 2 + 3);
  const groups: i32 = Math.floor(text.length / 4);
  for (let g: i32 = 0; g < groups; g++) {
    const from: i32 = g * 4;
    const bits: i32 =
      (values[text.charCodeAt(from) & 127] << 18) |
      (values[text.charCodeAt(from + 1) & 127] << 12) |
      (values[text.charCodeAt(from + 2) & 127] << 6) |
      values[text.charCodeAt(from + 3) & 127];
    const to: i32 = g * 3;
    bytes[to] = bits >> 16;
    bytes[to + 1] = (bits >> 8) & 255;
    bytes[to + 2] = bits & 255;
  }
  for (let i: i32 = 0; i < PIXELS; i++) out[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
}

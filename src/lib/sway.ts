import { frameX, frameY, HEIGHT, WIDTH } from "./frame";
import type { Globe } from "./globes";
import type { Painter } from "./painter";
import type { Wind } from "./wind";

// Parts of the painting that sway in the wind, by shearing their pixels
// sideways: none at the base row, `reach` px at the top. Each is a spring,
// so a gust bends it over and it rocks back with a little overshoot.
// A globe lists its parts (globes.ts) as source rect (x0, y0, x1, y1), the
// depth key its pixels carry (scene.ts: -128 for the open background, -30
// for Yule's Christmas tree), reach (px), natural frequency (Hz) and
// damping ratio.
const FIELDS = 8;
const MAX_PARTS = 4;
const FULL_WIND = 0.6; // wind speed (units/s) that bends a part fully

export class Sway {
  private count = 0;
  private tree = -1; // the part carrying the tree's bulbs
  private readonly parts = new Float64Array(MAX_PARTS * FIELDS);
  private readonly left = new Int32Array(MAX_PARTS);
  private readonly top = new Int32Array(MAX_PARTS);
  private readonly right = new Int32Array(MAX_PARTS);
  private readonly bottom = new Int32Array(MAX_PARTS);
  private readonly bend = new Float64Array(MAX_PARTS); // px at the top
  private readonly speed = new Float64Array(MAX_PARTS);
  // Each row's current shift (px), per part.
  private readonly shifts = new Int8Array(MAX_PARTS * HEIGHT);

  init(globe: Globe) {
    this.count = Math.min(MAX_PARTS, globe.sway.length / FIELDS);
    this.tree = globe.tree;
    this.shifts.fill(0);
    for (let i = 0; i < this.count * FIELDS; i++) this.parts[i] = globe.sway[i];
    for (let k = 0; k < this.count; k++) {
      const at = k * FIELDS;
      this.left[k] = Math.max(0, Math.round(frameX(this.parts[at])));
      this.top[k] = Math.max(0, Math.round(frameY(this.parts[at + 1])));
      this.right[k] = Math.min(WIDTH, Math.round(frameX(this.parts[at + 2])));
      this.bottom[k] = Math.min(HEIGHT - 1, Math.round(frameY(this.parts[at + 3])));
      this.bend[k] = 0;
      this.speed[k] = 0;
    }
  }

  // The settled picture was rebuilt unsheared: every row is redrawn.
  forget() {
    this.shifts.fill(0);
  }

  step(dt: number, wind: Wind) {
    const push = Math.max(-1, Math.min(1, wind.speed / FULL_WIND));
    for (let k = 0; k < this.count; k++) {
      const at = k * FIELDS;
      const omega = 2 * Math.PI * this.parts[at + 6];
      const target = push * this.parts[at + 5];
      const pull = -omega * omega * (this.bend[k] - target) - 2 * this.parts[at + 7] * omega * this.speed[k];
      this.speed[k] += pull * dt;
      this.bend[k] += this.speed[k] * dt;
    }
  }

  // The Christmas tree's shift (px) at frame row `y`, for its bulbs.
  treeShift(y: number): number {
    const tree = this.tree;
    if (tree < 0 || y < this.top[tree] || y > this.bottom[tree]) return 0;

    return this.shifts[tree * HEIGHT + y];
  }

  // Rewrites the rows whose shift changed, in the settled picture.
  draw(painter: Painter) {
    for (let k = 0; k < this.count; k++) {
      const top = this.top[k];
      const bottom = this.bottom[k];
      const height = bottom - top;
      for (let y = top; y <= bottom; y++) {
        const shift = Math.round((this.bend[k] * (bottom - y)) / height);
        const at = k * HEIGHT + y;
        if (shift === this.shifts[at]) continue;

        this.shifts[at] = shift;
        this.shear(painter, y, this.left[k], this.right[k], shift, this.parts[k * FIELDS + 4]);
        painter.claim(this.left[k], y, this.right[k] - this.left[k], 1);
      }
    }
  }

  // Row `y` of the part between `left` and `right`, `shift` px over: only
  // pixels carrying `key` move, and only from pixels that carry it too.
  private shear(painter: Painter, y: i32, left: i32, right: i32, shift: i32, key: i32) {
    const settled = painter.settled;
    const backdrop = painter.backdrop;
    const depth = painter.depth;
    const row: i32 = y * WIDTH;
    for (let x: i32 = left; x < right; x++) {
      const p: i32 = row + x;
      if (depth[p] !== key) continue;

      const from: i32 = x - shift;
      const q: i32 = row + from;
      const inside = from >= 0 && from < WIDTH && depth[q] === key;
      settled[p] = inside ? backdrop[q] : backdrop[p];
    }
  }
}

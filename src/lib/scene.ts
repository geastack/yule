import { SCALE } from "../data/backdrop";
import { CENTRE_X, CENTRE_Y, frameX, frameY, HEIGHT, PIXELS, RADIUS_X, RADIUS_Y, WIDTH } from "./frame";
import type { Globe } from "./globes";

// Something standing in the globe, traced from the painting in source
// pixels (x, y pairs), with where it sits in depth (world z, toward the
// viewer). Snow falling behind `back` is hidden by it.
export interface Solid {
  outline: number[];
  back: number;
  front: number;
  frontRow: number;
  lands: boolean;
}

// The wooden base hides everything below its rim.
const BASE: Solid = {
  outline: [
    0, 1015, 147, 1022, 220, 1040, 330, 1056, 515, 1064, 700, 1056, 810, 1040, 885, 1022, 1024, 1015, 1024, 1536, 0,
    1536,
  ],
  back: 1.27,
  front: 1.27,
  frontRow: 0,
  lands: false,
};

// The glass as painted (source px): an ellipse, and below, the curve where
// it sits in the walnut rim. Nothing live is drawn outside it.
const GLASS_X = 515;
const GLASS_Y = 640;
const GLASS_RADIUS_X = 462; // just inside the painted edge
const GLASS_RADIUS_Y = 524;
const RIM_X = 515;
const RIM_Y = 943;
const RIM_RADIUS_X = 400;
const RIM_RADIUS_Y = 140;
const OUTSIDE = 127; // a depth in front of everything

// Fixed depth lanes share the artwork's back-to-front range. Each lookup
// returns the first landing surface in the column for that lane.
export const SNOW_LAYERS: i32 = 20;
export function snowDepth(layer: number): number {
  return -95 + layer * 10;
}

export class Scene {
  readonly depth = new Int8Array(PIXELS);
  readonly landings = new Int16Array(SNOW_LAYERS * WIDTH);
  private readonly tops = new Int16Array(WIDTH);
  private readonly crossings = new Float32Array(64);
  // The depths every globe shares (the base, outside the glass), made on
  // the first build.
  readonly glass = new Int8Array(PIXELS);
  private sharedMade = false;

  // Rebuild the visibility and landing maps for the selected artwork.
  build(globe: Globe) {
    if (this.sharedMade) {
      this.depth.set(this.glass);
    } else {
      this.depth.fill(-128);
      this.add(BASE);
      this.maskGlass();
      this.glass.set(this.depth);
      this.sharedMade = true;
    }
    this.landings.fill(HEIGHT);
    for (let s = 0; s < globe.solids.length; s++) this.add(globe.solids[s]);
  }

  // Everything outside the glass counts as a solid in front, so snow,
  // smoke and stars stop at the glass and the rim.
  private maskGlass() {
    const centreX = frameX(GLASS_X);
    const centreY = frameY(GLASS_Y);
    const radiusX = GLASS_RADIUS_X * SCALE;
    const radiusY = GLASS_RADIUS_Y * SCALE;
    for (let x = 0; x < WIDTH; x++) {
      const t = (x - frameX(RIM_X)) / (RIM_RADIUS_X * SCALE);
      const rim = frameY(RIM_Y + RIM_RADIUS_Y * Math.sqrt(Math.max(0, 1 - t * t)));
      const dx = (x - centreX) / radiusX;
      for (let y = 0; y < HEIGHT; y++) {
        const dy = (y - centreY) / radiusY;
        if (dx * dx + dy * dy > 1 || y >= rim) this.depth[y * WIDTH + x] = OUTSIDE;
      }
    }
  }

  private add(solid: Solid) {
    const tops = this.tops;
    tops.fill(HEIGHT);
    const outline = solid.outline;
    const corners = outline.length / 2;
    const depth = Math.round(Math.min(127, solid.back * 100));

    // Even-odd scanline fill at pixel centres.
    const crossings = this.crossings;
    for (let y = 0; y < HEIGHT; y++) {
      const sy = y + 0.5;
      let count = 0;
      for (let a = 0, b = corners - 1; a < corners; b = a++) {
        const ax = frameX(outline[a * 2]);
        const ay = frameY(outline[a * 2 + 1]);
        const bx = frameX(outline[b * 2]);
        const by = frameY(outline[b * 2 + 1]);
        if (ay > sy !== by > sy) crossings[count++] = ((bx - ax) * (sy - ay)) / (by - ay) + ax;
      }
      for (let i = 1; i < count; i++) {
        const value = crossings[i];
        let j = i - 1;
        while (j >= 0 && crossings[j] > value) {
          crossings[j + 1] = crossings[j];
          j--;
        }
        crossings[j + 1] = value;
      }

      for (let c = 0; c + 1 < count; c += 2) {
        const from = Math.max(0, Math.ceil(crossings[c] - 0.5));
        const to = Math.min(WIDTH, Math.ceil(crossings[c + 1] - 0.5));
        for (let x = from; x < to; x++) {
          const p = y * WIDTH + x;
          if (this.depth[p] < depth) this.depth[p] = depth;
          if (solid.lands && this.glass[p] < OUTSIDE && tops[x] === HEIGHT) tops[x] = y;
        }
      }
    }

    if (!solid.lands) return;
    const eave = solid.frontRow > 0 ? frameY(solid.frontRow) : 0;
    for (let layer = 0; layer < SNOW_LAYERS; layer++) {
      const z = snowDepth(layer) / 100;
      if (z < solid.back || z > solid.front) continue;
      const across = solid.front === solid.back ? 0 : (z - solid.back) / (solid.front - solid.back);
      for (let x = 0; x < WIDTH; x++) {
        const top = tops[x];
        if (top === HEIGHT) continue;
        const row = Math.round(top + (Math.max(top, eave) - top) * across);
        const index = layer * WIDTH + x;
        if (row < this.landings[index]) this.landings[index] = row;
      }
    }
  }
}

// Panel position of a world point, for the painters.
export function screenX(x: number): number {
  return CENTRE_X + x * RADIUS_X;
}

export function screenY(y: number, z: number): number {
  return CENTRE_Y - (y * 0.94 - z * 0.342) * RADIUS_Y;
}

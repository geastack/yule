// Composes a square scene painting into the snow globe of art/backdrop.png:
// the scene fills the glass down to where the original's snow meets the
// walnut rim (measured from the painting, with a soft edge and a contact
// shadow), the glass keeps a soft highlight, and the glass edge, the black
// surround and the wooden base stay.
//
//   node scripts/compose.mjs <scene.png> <id>
//   → art/globes/<id>.jpg

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 1024;
const HEIGHT = 1536;
// The glass in the source: an ellipse, down to the rim.
const CENTRE_X = 515;
const CENTRE_Y = 640;
const RADIUS_X = 470;
const RADIUS_Y = 532;
const FEATHER = 0.03; // of the radius
// Where the glass meets the walnut rim in the original: the lower half of
// an ellipse, fitted by eye to the painting.
const RIM = { x: 515, y: 943, radiusX: 400, radiusY: 140 };
const RIM_SOFT = 3; // px the edge fades over
const SHADOW = 0.35; // darkening where the snow meets the rim
const SHADOW_PX = 22;
// The groove the glass sits in: a dark line along the rim, and just above
// it a faint highlight on the glass's lip, both fading out at the sides.
const GROOVE = 0.55; // darkening at the line's middle
const GROOVE_PX = 2.5; // half width
const LIP = 0.22; // towards white
const LIP_AT = 6; // px above the rim
const LIP_PX = 1.5; // half width
// Where the square scene goes: its bottom at y 1058, a little wider than
// the glass; below that its bottom rows are mirrored down to the rim.
const SCENE_SIZE = 960;
const SCENE_X = CENTRE_X - SCENE_SIZE / 2;
const SCENE_Y = 1058 - SCENE_SIZE;
// The glass highlight: a crescent up on the left, as in the original.
const SHINE = { x: 330, y: 330, radius: 330, inner: 300, offsetX: 34, offsetY: 30, strength: 0.4 };

const [scenePath, id] = process.argv.slice(2);
if (!scenePath || !id) throw new Error("usage: compose.mjs <scene.png> <id>");

const frame = await sharp(join(APP, "art/backdrop.png")).removeAlpha().raw().toBuffer();
const scene = await sharp(scenePath)
  .resize(SCENE_SIZE, SCENE_SIZE, { kernel: "lanczos3" })
  .removeAlpha()
  .raw()
  .toBuffer();

const rim = findRim();
const out = Buffer.from(frame);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const above = rim[x] - y;
    const cover = glass(x, y) * Math.min(1, Math.max(0, above / RIM_SOFT));
    groove(x, y, above);
    if (cover <= 0) continue;

    const sx = Math.min(SCENE_SIZE - 1, Math.max(0, x - SCENE_X));
    const sy = mirror(y - SCENE_Y);
    const from = (sy * SCENE_SIZE + sx) * 3;
    const to = (y * WIDTH + x) * 3;
    const shine = highlight(x, y);
    const shade = 1 - SHADOW * (1 - smooth(above / SHADOW_PX));
    for (let c = 0; c < 3; c++) {
      const painted = (scene[from + c] + (255 - scene[from + c]) * shine) * shade;
      out[to + c] = Math.round(frame[to + c] * (1 - cover) + painted * cover);
    }
    lip(x, y, above);
  }
}

mkdirSync(join(APP, "art/globes"), { recursive: true });
await sharp(out, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
  .jpeg({ quality: 92 })
  .toFile(join(APP, `art/globes/${id}.jpg`));
console.log(`composed art/globes/${id}.jpg`);

// Per column, the row where the snow meets the rim.
function findRim() {
  const rim = new Float64Array(WIDTH);
  for (let x = 0; x < WIDTH; x++) {
    const t = (x - RIM.x) / RIM.radiusX;
    rim[x] = RIM.y + RIM.radiusY * Math.sqrt(Math.max(0, 1 - t * t));
  }
  return rim;
}

// Darkens (x, y) on the line where the snow meets the rim.
function groove(x, y, above) {
  const strength = GROOVE * band(above, 0, GROOVE_PX) * ends(x);
  if (strength <= 0) return;

  const to = (y * WIDTH + x) * 3;
  for (let c = 0; c < 3; c++) out[to + c] = Math.round(frame[to + c] * (1 - strength));
}

// Lightens (x, y) on the glass's lip, just above the groove.
function lip(x, y, above) {
  const strength = LIP * band(above, LIP_AT, LIP_PX) * ends(x);
  if (strength <= 0) return;

  const to = (y * WIDTH + x) * 3;
  for (let c = 0; c < 3; c++) out[to + c] = Math.round(out[to + c] + (255 - out[to + c]) * strength);
}

// 1 at `at`, falling to 0 at `half` either side.
function band(value, at, half) {
  return Math.max(0, 1 - Math.abs(value - at) / half);
}

// 1 across the middle of the rim, fading out where it meets the glass sides.
function ends(x) {
  return 1 - smooth((Math.abs(x - RIM.x) / RIM.radiusX - 0.8) / 0.15);
}

// A scene row, its bottom rows mirrored on past the scene's edge.
function mirror(row) {
  if (row < 0) return 0;

  return row < SCENE_SIZE ? row : Math.max(0, 2 * SCENE_SIZE - 2 - row);
}

function smooth(t) {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

// How much of (x, y) is inside the glass, 0..1, feathered at its edge.
function glass(x, y) {
  const dx = (x - CENTRE_X) / RADIUS_X;
  const dy = (y - CENTRE_Y) / RADIUS_Y;
  const edge = 1 - Math.sqrt(dx * dx + dy * dy);
  return Math.min(1, Math.max(0, edge / FEATHER));
}

// The crescent between two offset circles, soft at both edges.
function highlight(x, y) {
  const outer = Math.hypot(x - SHINE.x, y - SHINE.y);
  const inner = Math.hypot(x - SHINE.x - SHINE.offsetX, y - SHINE.y - SHINE.offsetY);
  const inOuter = Math.min(1, Math.max(0, (SHINE.radius - outer) / 12));
  const outInner = Math.min(1, Math.max(0, (inner - SHINE.inner) / 40));
  const upper = Math.min(1, Math.max(0, (SHINE.y + 60 - y) / 200));
  return SHINE.strength * inOuter * outInner * upper;
}

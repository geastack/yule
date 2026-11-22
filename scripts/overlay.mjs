// Draws a globe's art/globes/<id>.json over its painting, to check the
// tracing by eye: solids (labelled with their depths), warm lights at their
// glow size (the first `fireplaces` in orange, the lamp in yellow), window
// glass (cyan), the lamp's pool, the chimney (red), sway parts (purple),
// bulb boxes (green) and the bulbs found in them (green dots).
//
//   node scripts/overlay.mjs <id> <out.png>

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCALE = 0.38; // source px to panel px, as scripts/bake.mjs fits them
const [id, out] = process.argv.slice(2);
if (!id || !out) throw new Error("usage: overlay.mjs <id> <out.png>");

const data = JSON.parse(readFileSync(join(APP, `art/globes/${id}.json`), "utf8"));
const source = id === "yule" ? join(APP, "art/backdrop.png") : join(APP, `art/globes/${id}.jpg`);
const { data: pixels, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });

const parts = [];
data.solids.forEach((solid, k) => {
  const points = [];
  for (let i = 0; i < solid.outline.length; i += 2) points.push(`${solid.outline[i]},${solid.outline[i + 1]}`);
  const hue = (k * 67) % 360;
  parts.push(
    `<polygon points="${points.join(" ")}" fill="hsla(${hue},90%,55%,0.18)" stroke="hsl(${hue},90%,60%)" stroke-width="3"/>`,
  );
  parts.push(
    `<text x="${solid.outline[0] + 6}" y="${solid.outline[1] + 26}" fill="hsl(${hue},90%,70%)" font-size="26" font-family="sans-serif">#${k} ${solid.back}..${solid.front}${solid.frontRow ? ` row ${solid.frontRow}` : ""}${solid.lands ? "" : " (no landing)"}</text>`,
  );
  if (solid.frontRow)
    parts.push(
      `<line x1="0" x2="1024" y1="${solid.frontRow}" y2="${solid.frontRow}" stroke="hsl(${hue},90%,60%)" stroke-dasharray="8 8"/>`,
    );
});
data.warm.forEach(([x, y, radius], k) => {
  const colour = k === data.lamp ? "#ff0" : k < data.fireplaces ? "#f90" : "#fc6";
  parts.push(`<circle cx="${x}" cy="${y}" r="${radius / SCALE}" fill="none" stroke="${colour}" stroke-width="3"/>`);
  parts.push(`<text x="${x + 6}" y="${y - 6}" fill="${colour}" font-size="22" font-family="sans-serif">w${k}</text>`);
});
data.glass.forEach(([x0, y0, x1, y1], k) => {
  parts.push(
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#0ff" stroke-width="2"/>`,
  );
  parts.push(`<text x="${x0}" y="${y1 + 20}" fill="#0ff" font-size="20" font-family="sans-serif">g${k}</text>`);
});
if (data.pool.length)
  parts.push(
    `<circle cx="${data.pool[0]}" cy="${data.pool[1]}" r="29" fill="none" stroke="#ff0" stroke-dasharray="6 6" stroke-width="3"/>`,
  );
if (data.chimney.length) {
  const [x, y, z] = data.chimney;
  parts.push(`<path d="M${x - 14},${y + 20} L${x},${y} L${x + 14},${y + 20} Z" fill="#f33"/>`);
  parts.push(
    `<text x="${x + 18}" y="${y + 8}" fill="#f66" font-size="22" font-family="sans-serif">smoke z ${z}</text>`,
  );
}
data.sway.forEach(([x0, y0, x1, y1, key], k) => {
  parts.push(
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#c6f" stroke-dasharray="12 6" stroke-width="3"/>`,
  );
  parts.push(
    `<text x="${x0 + 4}" y="${y0 + 24}" fill="#c6f" font-size="22" font-family="sans-serif">sway${k} key ${key}${k === data.tree ? " (tree)" : ""}</text>`,
  );
});
for (const [x0, y0, x1, y1] of data.bulbs) {
  parts.push(
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#3f3" stroke-width="2"/>`,
  );
  for (const [x, y] of findBulbs(x0, y0, x1, y1))
    parts.push(`<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="#3f3" stroke-width="3"/>`);
}

const svg = `<svg width="${info.width}" height="${info.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
const drawn = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 3 } })
  .composite([{ input: Buffer.from(svg) }])
  .png()
  .toBuffer();
// Just the glass.
await sharp(drawn).extract({ left: 0, top: 60, width: 1024, height: 1080 }).toFile(out);
console.log(`${out}: ${data.solids.length} solids, ${data.warm.length} warm, ${data.bulbs.length} bulb boxes`);

// Saturated bright blobs of 12-400 px in the box, as scripts/bake.mjs finds
// them (it keeps the 48 largest per globe).
function findBulbs(left, top, right, bottom) {
  const w = right - left;
  const h = bottom - top;
  const hot = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = ((top + y) * info.width + left + x) * 3;
      const max = Math.max(pixels[at], pixels[at + 1], pixels[at + 2]);
      hot[y * w + x] = max > 150 && max - Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) > 90 ? 1 : 0;
    }
  }
  const found = [];
  for (let start = 0; start < hot.length; start++) {
    if (!hot[start]) continue;

    const stack = [start];
    hot[start] = 0;
    let count = 0;
    let sx = 0;
    let sy = 0;
    while (stack.length) {
      const at = stack.pop();
      const x = at % w;
      count++;
      sx += x;
      sy += (at / w) | 0;
      for (const next of [at - 1, at + 1, at - w, at + w]) {
        if (next < 0 || next >= hot.length || !hot[next] || Math.abs((next % w) - x) > 1) continue;

        hot[next] = 0;
        stack.push(next);
      }
    }
    if (count >= 12 && count <= 400) found.push([left + sx / count, top + sy / count]);
  }
  return found;
}

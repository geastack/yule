// Stages the songs for the microSD card: splits each one listed in
// music/tracks.json (16 kHz mono 16-bit raw samples, see music/CREDITS.md
// for where each came from) out of <folder> into 2 MiB parts, "<file>.0",
// "<file>.1"... (the watch takes a pushed file whole into memory), and
// writes the playlist index the app reads (lib/music.ts):
// "file|title|performer" per line.
//
//   node scripts/music.mjs <folder>

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PART_BYTES = 2097152;
const folder = process.argv[2];
if (!folder) throw new Error("usage: music.mjs <folder with the .raw files>");

const tracks = JSON.parse(readFileSync(join(APP, "music/tracks.json"), "utf8"));
const out = join(APP, ".gea/sd/yule/music");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const lines = [];
for (const track of tracks) {
  const samples = readFileSync(join(folder, track.file));
  for (let part = 0; part * PART_BYTES < samples.length; part++) {
    writeFileSync(join(out, `${track.file}.${part}`), samples.subarray(part * PART_BYTES, (part + 1) * PART_BYTES));
  }
  lines.push(`${track.file}|${track.title}|${performer(track.artist)}`);
}
writeFileSync(join(out, "tracks.txt"), `${lines.join("\n")}\n`);
console.log(`staged ${tracks.length} songs`);

// Short enough for a menu row.
function performer(artist) {
  return artist.replace("United States Air Force", "US Air Force").replace(" (incompetech.com)", "");
}

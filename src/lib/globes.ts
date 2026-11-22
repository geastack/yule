import { GLOBE_TEXT } from "../data/globes";
import type { Solid } from "./scene";

// A snow globe: its painting (Yule's is built in; the others are read from
// the microSD card, see scripts/push.sh) and what in it is alive. All
// positions are source pixels of the 1024x1536 painting.
export interface Globe {
  id: string;
  name: string;
  style: string;
  // What stands in the globe, besides the snow floor and the base: snow
  // behind a solid is hidden by it, snow landing on it rests there.
  solids: Solid[];
  // Warm lights (x, y, glow radius px, strength each), with how many of
  // them (the first) flicker like a fire and which one is a street lamp
  // that stutters (-1: none).
  warm: number[];
  fireplaces: number;
  lamp: number;
  // Lit windows' and the lamp's glass (x0, y0, x1, y1 each), darkened as
  // their light dips: the first `windows` warm lights now and then go off.
  glass: number[];
  windows: number;
  pool: number[]; // the lamp's pool on the snow: x, y
  chimney: number[]; // its top: x, y, depth (world z)
  // Parts that sway in the wind (see sway.ts), and which one carries the
  // tree's bulbs (-1: none).
  sway: number[];
  tree: number;
}

// Most warm lights a globe has (lights.ts).
export const MAX_WARM = 8;

// In menu order, from art/globes/<id>.json (scripts/bake.mjs).
export const GLOBES: Globe[] = readGlobes(GLOBE_TEXT);

// The globe shown after flashing (an index into GLOBES): a build with a
// different one shows it, and the menu's choice is kept from then on.
export const DEFAULT_GLOBE = 0;

// Where the others' windows live on the card.
export function globePath(globe: Globe): string {
  return `/sdcard/yule/globes/${globe.id}.565`;
}

// The globes from their text, one per line: "id|name|style|numbers" (see
// globeLine in scripts/bake.mjs for the numbers' order).
function readGlobes(text: string): Globe[] {
  const globes: Globe[] = [];
  const lines = text.split("\n");
  for (let g = 0; g < lines.length; g++) {
    const parts = lines[g].split("|");
    const fields = parts[3].split(",");
    const values: number[] = [];
    for (let i = 0; i < fields.length; i++) values.push(Number(fields[i]));

    let at = 5;
    const solids: Solid[] = [];
    for (let k = 0; k < values[4]; k++) {
      const length = values[at + 4];
      solids.push({
        back: values[at],
        front: values[at + 1],
        frontRow: values[at + 2],
        lands: values[at + 3] === 1,
        outline: values.slice(at + 5, at + 5 + length),
      });
      at += 5 + length;
    }
    const lists: number[][] = [];
    for (let f = 0; f < 5; f++) {
      const length = values[at];
      lists.push(values.slice(at + 1, at + 1 + length));
      at += 1 + length;
    }
    globes.push({
      id: parts[0],
      name: parts[1],
      style: parts[2],
      solids,
      warm: lists[0],
      fireplaces: values[0],
      lamp: values[1],
      glass: lists[1],
      windows: values[2],
      pool: lists[2],
      chimney: lists[3],
      sway: lists[4],
      tree: values[3],
    });
  }
  return globes;
}

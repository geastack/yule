# How Yule works

The [README](../README.md) covers flashing and using it. The sections below
cover what moves in each globe, how the snow behaves, and how the pictures
and songs get onto the board.

## What is alive in each globe

Every globe has the same snow, wind, glint on the glass, and stars and
shooting stars wherever its sky is open dark blue. The rest is traced by hand
from its painting in `art/globes/<id>.json` (source pixels; check one with
`node scripts/overlay.mjs <id> out.png`):

- **Solids**: buildings, trees, figures and vehicles, each an outline with a
  depth, so snow passes behind them and lands on their roofs and branches.
- **Warm lights**: windows, lanterns, campfires and lamps. Fires flicker,
  windows now and then go dark for a few seconds, and one lamp may stutter
  like an old bulb.
- **Bulbs**: found in boxes over each tree's lights, carousel rim, Ferris
  wheel or arch, changing pattern every 20-30 s (twinkle, a chase, a slow
  fade).
- **Chimney smoke** or steam where it is painted, and trees that **sway** in
  the wind.

Yule is built into the firmware; the other 26 are read from the microSD card
and switched in place. Each painting was generated as a square scene and
composited into Yule's glass and wooden base by
[`scripts/compose.mjs`](../scripts/compose.mjs).

## The snow

There are 300 flakes, each falling at its own speed with its own small drift
and sway. Tilting the board left or right drifts the falling snow that way.

Shaking builds up a current in the water over about a second, and it dies
down over a little longer once you stop. While it runs it lifts settled snow
and carries it around; each flake has its own grip, so the loosest go first. Flakes bounce off the glass and settle on the ground, the
roofs and the branches. A painted solid hides any flake behind it.

A finger pushes the flakes near it. Touching the glass makes the settled snow
hop.

Every 8-20 s a gust builds over half a second, holds 1-2 s and fades over
2-3 s. It drifts the snow, lifts loose snow, flattens the smoke and bends the
trees, which rock back with a little overshoot. Settings turns it off.

## Lights and stars

The street lamp in Yule stutters every 20-60 s (2-4 quick dips). Fires
flicker behind the windows, and about once a minute a window goes dark for a
few seconds. The painted stars twinkle, and every 15-40 s a shooting star
crosses the open sky, hidden behind the house and trees.

To see one on demand, hold still for 0.7 s on the wooden base for a gust
(`gea devctl tap 205 450 900`), on Yule's street lamp for a stutter
(`gea devctl tap 64 202 900`), or on the sky for a shooting star
(`gea devctl tap 205 80 900`).

## Music

Songs stream from the card an 8 KB chunk at a time, 1.5 s ahead of the
player, and the playlist loops. The music box is synthesised on the board: a
plucked tine is three partials and a click, rendered once per pitch. Shaking
winds its spring, and the tune slows and stops as it runs down.

## The microSD card

```sh
node scripts/bake.mjs                          # globes -> .gea/sd/yule/globes
node scripts/music.mjs <folder of .raw songs>  # songs -> .gea/sd/yule/music
sh scripts/push.sh                             # both onto the card over USB
```

The songs are 16 kHz mono 16-bit raw samples (about 47 MB for 26 minutes),
stored as 2 MiB parts: the board takes a pushed file whole into memory, and
anything over about 3 MB fails. Push with the menu open and music off, or the
board's log lines can garble the push. [`music/CREDITS.md`](../music/CREDITS.md)
lists each song's source and licence.

## Files

| File | Role |
| --- | --- |
| [`scripts/compose.mjs`](../scripts/compose.mjs) | Puts a square scene painting into the glass: `art/globes/<id>.jpg` |
| `art/globes/<id>.json` | Each globe's tracing: solids, warm lights, the lamp, the chimney, swaying parts, and where its bulbs are |
| [`scripts/overlay.mjs`](../scripts/overlay.mjs) | Draws a globe's tracing over its painting, to check it by eye |
| [`scripts/bake.mjs`](../scripts/bake.mjs) | Fits each globe to the screen and finds its bulbs; writes Yule into the app and the others to `.gea/sd/yule/globes` |
| [`scripts/music.mjs`](../scripts/music.mjs), [`scripts/push.sh`](../scripts/push.sh) | Stage the songs and copy everything onto the card |
| `src/lib/globes.ts` | The 27 globes in menu order, and the first one shown |
| `src/navigation.ts`, `src/screens/menu.tsx`, `src/stores/` | The menu and settings; choices are kept on the board |
| `src/lib/yule.ts` | The frame loop and touch |
| `src/lib/motion.ts` | Accelerometer and gyro to tilt, jolt and turn |
| `src/lib/water.ts` | The current a shake or a finger sets going |
| `src/lib/snow.ts` | The flakes |
| `src/lib/scene.ts` | A globe's solids: what hides the snow and where it lands |
| `src/lib/painter.ts` | Draws the frame and puts back only what changed |
| `src/lib/lights.ts`, `src/lib/stars.ts`, `src/lib/smoke.ts`, `src/lib/wind.ts`, `src/lib/sway.ts` | Lights, stars, smoke, wind and swaying trees |
| `src/lib/music.ts`, `src/lib/player.worklet.ts` | The playlist and the music box |

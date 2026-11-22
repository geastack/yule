import { OFFSET_X, OFFSET_Y, SCALE, WINDOW_H, WINDOW_W, WINDOW_X, WINDOW_Y } from "../data/backdrop";

// The frame: the globe's window of the 410x502 panel (everything that moves
// is inside it), as RGB565 words, `y * WIDTH + x`. The wooden base below it
// is a static asset.
export const WIDTH = WINDOW_W;
export const HEIGHT = WINDOW_H;
export const PIXELS = WINDOW_W * WINDOW_H;
export const PANEL_W = 410;
export const PANEL_H = 502;

// The world: the globe's water is the unit sphere, x right, y up, z toward
// the viewer. The painting looks down on it a little (TILT), and its glass is
// a slightly tall ellipse on screen (centre 515,640, radii 486 x 548 in
// source pixels). Positions below are in frame pixels.
export const CENTRE_X = frameX(515);
export const CENTRE_Y = frameY(640);
export const RADIUS_X = 486 * SCALE;
export const RADIUS_Y = 548 * SCALE;
export const TILT_SIN = 0.342; // 20 degrees
export const TILT_COS = 0.94;

// Source (1024x1536 art) pixels to frame pixels.
export function frameX(sourceX: number): number {
  return sourceX * SCALE + OFFSET_X - WINDOW_X;
}

export function frameY(sourceY: number): number {
  return sourceY * SCALE + OFFSET_Y - WINDOW_Y;
}

// World height whose projection at depth `z` lands on panel row `row`.
export function heightAt(row: number, z: number): number {
  return ((CENTRE_Y - row) / RADIUS_Y + z * TILT_SIN) / TILT_COS;
}

// The sine of 1024 steps per turn.
export const SINE = new Float32Array(1024);

for (let i = 0; i < 1024; i++) SINE[i] = Math.sin((i * Math.PI) / 512);

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// RGB565 spread over 32 bits (G in 21-26, R in 11-15, B in 0-4): the gaps
// absorb a blend's borrows, so one multiply weighs all three channels.
export const SPREAD = 0x07e0f81f;

export function spread(colour: number): number {
  return (colour | (colour << 16)) & SPREAD;
}

export function pack565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | ((b & 0xf8) >> 3);
}

let randomState = 0x2545f491;

// xorshift32 in 0..1.
export function random(): number {
  let x = randomState;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  randomState = x;
  return (x >>> 0) / 4294967296;
}

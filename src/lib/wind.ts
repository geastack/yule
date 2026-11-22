import { random, smoothstep } from "./frame";

// A light breeze that wanders, and now and then a strong gust: it builds
// over BUILD_S, holds, then dies away. Strength is in world units/s across
// the screen (+ to the right).
const BREEZE = 0.05;
const GUST = 0.4;
const GUST_EVERY_LOW_S = 8;
const GUST_EVERY_HIGH_S = 20;
const BUILD_S = 0.5;
const HOLD_LOW_S = 1;
const HOLD_HIGH_S = 2;
const FADE_LOW_S = 2;
const FADE_HIGH_S = 3;

export class Wind {
  // Breeze and gusts on (false: still air; the settings page).
  enabled = true;
  // The wind across the screen (units/s), and the gust's share of it (0..1).
  speed = 0;
  gust = 0;
  private time = 0;
  private gustAt = 0; // seconds since the current gust began
  private hold = 0;
  private fade = 0;
  private side = 1;
  private untilGust = 0;

  init() {
    this.untilGust = GUST_EVERY_LOW_S * 0.5 + random() * 4;
    this.gustAt = -1;
  }

  step(dt: number) {
    if (!this.enabled) {
      this.speed = 0;
      this.gust = 0;
      return;
    }

    this.time += dt;
    this.untilGust -= dt;
    if (this.untilGust <= 0 && this.gustAt < 0) this.startGust();
    if (this.gustAt >= 0) this.gustAt += dt;

    this.gust = this.envelope();
    const t = this.time;
    const breeze = BREEZE * (0.6 + 0.4 * Math.sin(t * 0.31) + 0.25 * Math.sin(t * 0.83 + 1.7));
    this.speed = this.side * (breeze + GUST * this.gust);
  }

  // A gust now, unless one is blowing (a dev trigger: long-press the base).
  gustNow() {
    if (this.enabled && this.gustAt < 0) this.startGust();
  }

  private startGust() {
    this.gustAt = 0;
    this.hold = HOLD_LOW_S + random() * (HOLD_HIGH_S - HOLD_LOW_S);
    this.fade = FADE_LOW_S + random() * (FADE_HIGH_S - FADE_LOW_S);
    this.side = random() < 0.5 ? -1 : 1;
  }

  // Builds, holds and dies away; then schedules the next gust.
  private envelope(): number {
    const at = this.gustAt;
    if (at < 0) return 0;

    if (at < BUILD_S) return smoothstep(0, BUILD_S, at);

    if (at < BUILD_S + this.hold) return 1;

    const out = at - BUILD_S - this.hold;
    if (out < this.fade) return 1 - smoothstep(0, this.fade, out);

    this.gustAt = -1;
    this.untilGust = GUST_EVERY_LOW_S + random() * (GUST_EVERY_HIGH_S - GUST_EVERY_LOW_S);
    return 0;
  }
}

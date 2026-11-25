import {
  type CanvasRenderingContext2D,
  type GeaCanvasElement,
  type GeaEmbeddedImage,
  type ImageData565,
  loadAssetImage,
  Profiler,
  readCacheFile,
} from "@geastack/core";
import { BACKDROP, WINDOW_X, WINDOW_Y } from "../data/backdrop";
import { CYCLE_MINUTES, settings } from "../stores/settings";
import { CENTRE_X, CENTRE_Y, HEIGHT, PIXELS, WIDTH } from "./frame";
import { GLOBES, globePath } from "./globes";
import { Lights } from "./lights";
import { Motion } from "./motion";
import { Music } from "./music";
import { decodeBackdrop, Painter } from "./painter";
import { Scene } from "./scene";
import { Smoke } from "./smoke";
import { Snow } from "./snow";
import { Stars } from "./stars";
import { Sway } from "./sway";
import { Water } from "./water";
import { Wind } from "./wind";

const MAX_STEP_S = 0.1; // longer stalls run slow, not jumpy
const TAP_SLOP_PX = 12;
const TAP_MS = 300;
// A tap on the wooden base opens the menu. A still press this long is a dev
// trigger, by where it is (panel px): the base starts a gust, Yule's street
// lamp stutters, the sky sends a shooting star.
const HOLD_MS = 700;
// A quick, mostly sideways flick changes the globe (left: the next one); a
// slower drag stirs the water.
const SWIPE_PX = 70;
const SWIPE_MS = 450;
const BASE_TOP = 400;
const LAMP_X = 64;
const LAMP_Y = 202;
const LAMP_REACH = 40;
const SKY_BELOW = 150; // above this row, the sky sends a shooting star
// ... and anywhere else in the glass, a hard shake.

export const CANVAS_ID = "yule-globe";

const ATTACH_TRIES = 10;

// The panel: the globe's window, uploaded every frame, over the wooden base,
// a static asset the display skips once it is up. (Each upload converts the
// whole image, so the smaller the window, the faster the frame.)
//
// Every canvas call goes through the `ctx` field: generated code passes a
// context parameter by value, and a copy's recorded commands are lost.
class Screen {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: GeaEmbeddedImage = loadAssetImage("art/base.png");
  readonly image: ImageData565;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.image = ctx.createImageData565(WIDTH, HEIGHT);
  }

  present() {
    this.ctx.beginBatch();
    // An opaque first command lets the display diff frames and send only
    // what changed: here, just the window. The positions are constants:
    // with variable ones the display re-sends the whole panel every frame.
    this.ctx.clear();
    this.ctx.drawImage(this.base, 0, WINDOW_Y + HEIGHT);
    this.ctx.putImageData(this.image, WINDOW_X, WINDOW_Y);
    this.ctx.endBatch();
  }
}

// The snow globe: reads the watch's motion, moves the water, the snow and
// the smoke, and draws the live layers over the globe's picture.
class Yule {
  private readonly scene = new Scene();
  private readonly snow = new Snow();
  private readonly smoke = new Smoke();
  private readonly lights = new Lights();
  private readonly stars = new Stars();
  private readonly motion = new Motion();
  private readonly water = new Water();
  private readonly wind = new Wind();
  private readonly sway = new Sway();
  readonly music = new Music();
  // The globe's picture, as baked (Yule's built in, the rest from the card).
  private readonly picture = new Uint16Array(PIXELS);
  private readonly tick = (nowMs: number) => this.frame(nowMs);
  private screen: Screen | null = null;
  private painter: Painter | null = null;
  private lastMs = -1;
  private time = 0;
  private finger = -1;
  private downMs = 0;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;
  private paused = false;
  private sinceCycle = 0;
  private unsaved = false; // a globe just shown, to save again (settings.resave)
  private profileFrames = 0;
  private readonly profileUs = new Float64Array(9);

  start() {
    settings.load();
    this.motion.start();
    this.snow.init();
    this.smoke.init();
    this.stars.init();
    this.lights.prepare();
    this.wind.init();
    this.wind.enabled = settings.wind;
    this.music.list();
    settings.fitTrack(this.music.titles.length);
    this.music.start(settings.track, settings.volume, settings.music);
    requestAnimationFrame(() => this.attach(0));
  }

  // Globe number `index` in place of the one showing, its snow spread
  // through the water to fall, and remembered; Yule when its picture is not
  // on the card.
  showGlobe(index: number) {
    const painter = this.painter;
    if (!painter) return;

    let shown = index;
    if (!this.loadPicture(index)) {
      shown = 0;
      this.loadPicture(0);
    }
    const globe = GLOBES[shown];
    this.scene.build(globe);
    painter.reload();
    this.stars.load(this.picture, this.scene.depth);
    this.lights.init(globe, shown);
    this.smoke.load(globe);
    this.sway.init(globe);
    this.snow.spread(this.scene);
    this.sinceCycle = 0;
    settings.setGlobe(shown);
    this.unsaved = true;
  }

  private loadPicture(index: number): boolean {
    const picture = this.picture;
    if (index === 0) {
      decodeBackdrop(BACKDROP, picture);
      return true;
    }

    const bytes = readCacheFile(globePath(GLOBES[index]));
    if (bytes.length !== PIXELS * 2) return false;

    const buffer: ArrayBuffer = bytes.buffer as ArrayBuffer;
    picture.set(new Uint16Array(buffer));
    return true;
  }

  // While the menu is open the globe stands still; the music plays on.
  pause(paused: boolean) {
    this.paused = paused;
    this.finger = -1;
  }

  setWind(on: boolean) {
    this.wind.enabled = on;
  }

  down(id: number, x: number, y: number) {
    if (this.paused || this.finger >= 0) return;

    this.finger = id;
    this.downX = x;
    this.downY = y;
    this.lastX = x;
    this.lastY = y;
    this.downMs = Date.now();
    this.moved = 0;
    if (y < BASE_TOP) this.snow.stir(x - WINDOW_X, y - WINDOW_Y, 0, -2);
    this.music.wake();
  }

  move(id: number, x: number, y: number) {
    if (id !== this.finger) return;

    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.snow.stir(x - WINDOW_X, y - WINDOW_Y, dx, dy);
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.water.drag(dx, dy, x - WINDOW_X - CENTRE_X, y - WINDOW_Y - CENTRE_Y);
    this.lastX = x;
    this.lastY = y;
  }

  // True for a tap on the base: the menu's to open. A swipe changes the
  // globe.
  up(id: number): boolean {
    if (id !== this.finger) return false;

    this.finger = -1;
    const held = Date.now() - this.downMs;
    const dx = this.lastX - this.downX;
    const dy = this.lastY - this.downY;
    if (held <= SWIPE_MS && Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) {
      const step = dx < 0 ? 1 : GLOBES.length - 1;
      this.showGlobe((settings.globe + step) % GLOBES.length);
      return false;
    }

    if (this.moved > TAP_SLOP_PX) return false;

    if (held >= HOLD_MS) {
      this.trigger(this.lastX, this.lastY);
      return false;
    }

    if (held > TAP_MS) return false;

    if (this.lastY >= BASE_TOP) return true;

    this.water.tap();
    return false;
  }

  // Dev triggers, so each rare event can be called up to look at.
  private trigger(x: number, y: number) {
    if (y >= BASE_TOP) this.wind.gustNow();
    else if (Math.abs(x - LAMP_X) < LAMP_REACH && Math.abs(y - LAMP_Y) < LAMP_REACH) this.lights.stutterNow();
    else if (y < SKY_BELOW) this.stars.shootNow();
    else this.shake();
  }

  // The canvas exists once the screen has been laid out.
  private attach(tries: number) {
    const canvas = document.getElementById(CANVAS_ID) as unknown as GeaCanvasElement | null;
    if (!canvas) {
      if (tries < ATTACH_TRIES) requestAnimationFrame(() => this.attach(tries + 1));
      return;
    }

    const screen = new Screen(canvas.getContext("2d"));
    this.screen = screen;
    this.painter = new Painter(screen.image.data16, this.picture, this.scene.depth);
    this.showGlobe(settings.globe);
    requestAnimationFrame(this.tick);
  }

  private frame(nowMs: number) {
    const screen = this.screen;
    const painter = this.painter;
    if (!screen || !painter) return;

    const dt = this.lastMs < 0 ? 0.016 : Math.min(MAX_STEP_S, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    this.time += dt;
    if (this.unsaved) {
      settings.resave();
      this.unsaved = false;
    }
    if (this.paused) {
      this.music.update(dt, 0);
      requestAnimationFrame(this.tick);
      return;
    }

    this.cycle(dt);
    const motion = this.motion;
    const wind = this.wind;
    const water = this.water;
    const startUs = Profiler.nowUs();
    motion.read(dt);
    water.step(dt, motion);
    wind.step(dt);
    water.blow(wind.gust, dt);
    this.sway.step(dt, wind);
    const beforeSnow = Profiler.nowUs();
    this.snow.step(dt, motion, water, wind);
    const afterSnow = Profiler.nowUs();
    this.smoke.step(dt, motion, water, wind);
    this.lights.step(dt);
    this.stars.step(dt);
    this.music.update(dt, motion.wind);
    const beforeSwayDraw = Profiler.nowUs();
    if (this.snow.restoreDeposits(painter)) this.sway.forget();
    // Swaying rows change the settled picture; the restore picks them up.
    this.sway.draw(painter);
    const beforeRestore = Profiler.nowUs();
    painter.restore();
    const afterRestore = Profiler.nowUs();
    this.stars.draw(painter);
    this.lights.drawBehind(painter, this.sway);
    this.smoke.draw(painter);
    const beforeDraw = Profiler.nowUs();
    this.snow.draw(painter);
    const afterDraw = Profiler.nowUs();
    this.lights.drawFront(painter, motion, dt);
    const beforePresent = Profiler.nowUs();
    screen.present();
    this.profileUs[0] += beforeSnow - startUs;
    this.profileUs[1] += afterSnow - beforeSnow;
    this.profileUs[2] += beforeSwayDraw - afterSnow;
    this.profileUs[3] += afterDraw - beforeDraw;
    this.profileUs[4] += beforePresent - afterDraw;
    this.profileUs[5] += Profiler.nowUs() - beforePresent;
    this.profileUs[6] += beforeRestore - beforeSwayDraw;
    this.profileUs[7] += afterRestore - beforeRestore;
    this.profileUs[8] += beforeDraw - afterRestore;
    this.profileFrames++;
    if (this.profileFrames === 30) {
      const p = this.profileUs;
      console.log(
        `yule profile us: motion=${Math.round(p[0] / 30)} physics=${Math.round(p[1] / 30)} update=${Math.round(p[2] / 30)} draw=${Math.round(p[3] / 30)} front=${Math.round(p[4] / 30)} present=${Math.round(p[5] / 30)} sway=${Math.round(p[6] / 30)} restore=${Math.round(p[7] / 30)} backdrop=${Math.round(p[8] / 30)}`,
      );
      p.fill(0);
      this.profileFrames = 0;
    }
    requestAnimationFrame(this.tick);
  }

  // A hard shake of the water (a dev trigger: long-press inside the
  // glass), for trying the snow without a hand on the board.
  private shake() {
    this.water.shake(1);
  }

  // With the settings' "change globe" on, the next one every few minutes.
  private cycle(dt: number) {
    if (!settings.cycle) return;

    this.sinceCycle += dt;
    if (this.sinceCycle < CYCLE_MINUTES * 60) return;

    this.showGlobe((settings.globe + 1) % GLOBES.length);
  }
}

export const yule = new Yule();

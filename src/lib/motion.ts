import { Accelerometer } from "@geastack/core";
import { clamp } from "./frame";

// What the board's sensors say, in world axes (x right across the screen,
// y up the screen, z out of it): which way gravity points (all the way
// round, into the screen when it lies flat), how hard the glass is being
// jolted, and how fast it is turning. lib/water.ts turns that into moving
// water, lib/snow.ts into where the snow falls.
//
// Gravity is the accelerometer's slow part, carried round by the gyro as
// the board turns, so a slow turn changes only gravity: what is left over
// (the glass's own acceleration) is the jolt, and only that stirs.
//
// The sensor reads specific force in m/s² (at rest, 9.8 pointing up) and
// rotation in °/s. On the AMOLED 2.06 its +x runs up the screen, its +y to
// the screen's right (tilting the board left must send the snow left) and
// its +z into the screen; `read` turns both into screen axes. Every sensor
// value is its own I2C read (~0.6 ms); all six are read each frame, so the
// snow answers the hand at once.

const DEGREES = Math.PI / 180;
const GRAVITY = 9.80665;
const GRAVITY_S = 4; // how fast the sensor's scale is learned
const REST_S = 0.2; // how fast the gravity estimate settles on the sensor
const DOWN_S = 0.06; // and how fast down follows it
const SPIN_DEAD = 3; // °/s of gyro noise ignored
// The gyro reads a few °/s even lying still: its slow average (while it is
// not turning hard) is taken as that offset and subtracted.
const BIAS_S = 3;
const BIAS_TURN = 25; // °/s: faster than this is a real turn, not drift

export class Motion {
  // Gravity's direction (unit, world axes).
  downX = 0;
  downY = -1;
  downZ = 0;
  // How far the board leans right and up, for the glass glint (-1..1).
  leanX = 0;
  leanY = 0;
  // This frame's jolt beyond gravity (m/s², world axes) and its size.
  shakeX = 0;
  shakeY = 0;
  shakeZ = 0;
  jolt = 0;
  // A hard shake this frame (0..1), for the music box.
  wind = 0;
  // How fast the glass turns (rad/s about x, y, z).
  spinX = 0;
  spinY = 0;
  spinZ = 0;

  private restX = 0;
  private restY = 0;
  private restZ = GRAVITY;
  private primed = false;
  // The magnitude the sensor reports for 1 g.
  private gravity = GRAVITY;
  // The latest readings in screen axes: specific force (m/s²), rotation (rad/s).
  private feelX = 0;
  private feelY = 0;
  private feelZ = GRAVITY;
  private readonly bias = new Float64Array(3); // gyro offset, °/s
  private biasPrimed = false;

  start() {
    Accelerometer.start();
  }

  read(dt: number) {
    this.spinX = this.unbiased(0, Accelerometer.gyroscopeY, dt) * DEGREES;
    this.spinY = this.unbiased(1, Accelerometer.gyroscopeX, dt) * DEGREES;
    this.spinZ = -this.unbiased(2, Accelerometer.gyroscopeZ, dt) * DEGREES;
    this.biasPrimed = true;
    // The board's accelerometer reads 2 g at rest: scale by the gravity it
    // has been seeing.
    if (!this.primed) this.gravity = rawMagnitude();
    const scale = GRAVITY / this.gravity;
    this.feelX = Accelerometer.accelerationY * scale;
    this.feelY = Accelerometer.accelerationX * scale;
    this.feelZ = -Accelerometer.accelerationZ * scale;
    const felt = Math.sqrt(this.feelX * this.feelX + this.feelY * this.feelY + this.feelZ * this.feelZ) / scale;
    if (felt > 3) this.gravity += (felt - this.gravity) * (1 - Math.exp(-dt / GRAVITY_S));
    const x = this.feelX;
    const y = this.feelY;
    const z = this.feelZ;
    if (!this.primed) {
      this.restX = x;
      this.restY = y;
      this.restZ = z;
      this.primed = true;
    }

    // The resting force turns with the board (seen from the board, a fixed
    // vector turns the other way), then settles on what the sensor reads.
    const rx = this.restX;
    const ry = this.restY;
    const rz = this.restZ;
    this.restX = rx + (ry * this.spinZ - rz * this.spinY) * dt;
    this.restY = ry + (rz * this.spinX - rx * this.spinZ) * dt;
    this.restZ = rz + (rx * this.spinY - ry * this.spinX) * dt;
    const follow = 1 - Math.exp(-dt / REST_S);
    this.restX += (x - this.restX) * follow;
    this.restY += (y - this.restY) * follow;
    this.restZ += (z - this.restZ) * follow;
    this.shakeX = x - this.restX;
    this.shakeY = y - this.restY;
    this.shakeZ = z - this.restZ;
    this.jolt = Math.sqrt(this.shakeX * this.shakeX + this.shakeY * this.shakeY + this.shakeZ * this.shakeZ);
    this.wind = clamp((this.jolt - 6) / 14, 0, 1);
    this.fall(dt);
  }

  // A gyro reading (°/s) less its learned offset, noise ignored.
  private unbiased(axis: number, degreesPerSecond: number, dt: number): number {
    if (!this.biasPrimed) this.bias[axis] = degreesPerSecond;
    const turn = degreesPerSecond - this.bias[axis];
    if (Math.abs(turn) < BIAS_TURN) this.bias[axis] += turn * (1 - Math.exp(-(2 * dt) / BIAS_S));
    return dead(degreesPerSecond - this.bias[axis]);
  }

  // Down follows gravity, which pulls opposite the resting force.
  private fall(dt: number) {
    const g = Math.sqrt(this.restX * this.restX + this.restY * this.restY + this.restZ * this.restZ);
    if (g < 1) return;

    const follow = 1 - Math.exp(-dt / DOWN_S);
    const downX = this.downX + (-this.restX / g - this.downX) * follow;
    const downY = this.downY + (-this.restY / g - this.downY) * follow;
    const downZ = this.downZ + (-this.restZ / g - this.downZ) * follow;
    const length = Math.max(0.001, Math.sqrt(downX * downX + downY * downY + downZ * downZ));
    this.downX = downX / length;
    this.downY = downY / length;
    this.downZ = downZ / length;
    this.leanX = clamp(this.downX * 2, -1, 1);
    this.leanY = clamp(this.downY * 2, -1, 1);
  }
}

function rawMagnitude(): number {
  const x = Accelerometer.accelerationX;
  const y = Accelerometer.accelerationY;
  const z = Accelerometer.accelerationZ;
  return Math.max(3, Math.sqrt(x * x + y * y + z * z));
}

function dead(degreesPerSecond: number): number {
  if (degreesPerSecond > SPIN_DEAD) return degreesPerSecond - SPIN_DEAD;
  if (degreesPerSecond < -SPIN_DEAD) return degreesPerSecond + SPIN_DEAD;
  return 0;
}

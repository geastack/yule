import { Accelerometer } from "@geastack/core";
import { clamp, smoothstep } from "./frame";

// What the board's sensors say, in world axes (x right across the screen,
// y up the screen, z out of it): which way the snow should fall,
// how hard the glass is being
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
// value is its own I2C read. Sample acceleration every frame and reuse
// the latest gyro sample between reads.

const DEGREES = Math.PI / 180;
const GRAVITY = 9.80665;
const GRAVITY_S = 4; // how fast the sensor's scale is learned
const REST_S = 0.32; // how fast the gravity estimate settles on the sensor
const DOWN_S = 0.04; // and how fast down follows it
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
  private readonly bias = new Float64Array(3); // gyro offset, °/s
  private biasPrimed = false;
  private gyroElapsed = 0;

  start() {
    Accelerometer.start();
  }

  read(dt: number) {
    this.gyroElapsed += dt;
    if (!this.biasPrimed || this.gyroElapsed >= 0.075) {
      const elapsed = this.gyroElapsed;
      this.gyroElapsed = 0;
      this.spinX = this.unbiased(0, Accelerometer.gyroscopeY, elapsed) * DEGREES;
      this.spinY = this.unbiased(1, Accelerometer.gyroscopeX, elapsed) * DEGREES;
      this.spinZ = -this.unbiased(2, Accelerometer.gyroscopeZ, elapsed) * DEGREES;
      this.biasPrimed = true;
    }
    this.readAcceleration(Accelerometer.accelerationY, Accelerometer.accelerationX, -Accelerometer.accelerationZ, dt);
  }

  private readAcceleration(rawX: number, rawY: number, rawZ: number, dt: number) {
    const felt = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ);
    if (!this.primed && felt >= 3) this.gravity = felt;
    const scale = GRAVITY / this.gravity;
    const x = rawX * scale;
    const y = rawY * scale;
    const z = rawZ * scale;
    if (felt < 3 && !this.primed) return;
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
    this.shakeX = x - this.restX;
    this.shakeY = y - this.restY;
    this.shakeZ = z - this.restZ;
    this.jolt = Math.sqrt(this.shakeX * this.shakeX + this.shakeY * this.shakeY + this.shakeZ * this.shakeZ);
    const follow = 1 - Math.exp(-dt / REST_S);
    this.restX += this.shakeX * follow;
    this.restY += this.shakeY * follow;
    this.restZ += this.shakeZ * follow;
    if (felt > 3 && this.jolt < 0.6) {
      this.gravity += (felt - this.gravity) * (1 - Math.exp(-dt / GRAVITY_S));
    }
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

  // A flat display (including the browser's resting pose) shows an
  // upright globe. Blend toward sensor gravity as the screen tilts.
  private fall(dt: number) {
    const g = Math.sqrt(this.restX * this.restX + this.restY * this.restY + this.restZ * this.restZ);
    if (g < 1) return;

    const inPlane = Math.sqrt(this.restX * this.restX + this.restY * this.restY) / g;
    const tilt = smoothstep(0.035, 0.3, inPlane);
    const targetX = (-this.restX / g) * tilt;
    const targetY = (-this.restY / g) * tilt - (1 - tilt);
    const targetZ = (-this.restZ / g) * tilt;
    const follow = 1 - Math.exp(-dt / DOWN_S);
    const downX = this.downX + (targetX - this.downX) * follow;
    const downY = this.downY + (targetY - this.downY) * follow;
    const downZ = this.downZ + (targetZ - this.downZ) * follow;
    const length = Math.max(0.001, Math.sqrt(downX * downX + downY * downY + downZ * downZ));
    this.downX = downX / length;
    this.downY = downY / length;
    this.downZ = downZ / length;
    this.leanX = clamp(this.downX * 2, -1, 1);
    this.leanY = clamp(this.downY * 2, -1, 1);
  }
}

function dead(degreesPerSecond: number): number {
  if (degreesPerSecond > SPIN_DEAD) return degreesPerSecond - SPIN_DEAD;
  if (degreesPerSecond < -SPIN_DEAD) return degreesPerSecond + SPIN_DEAD;
  return 0;
}

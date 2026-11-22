import { defineConfig } from "vite";

// What the browser preview lacks, stood in for:
// - an accelerometer: the board lying face-up on a table. Set
//   `__gea_Accelerometer.feel` (m/s² along the sensor's x, y, z; x runs up
//   the screen, y to its right, z into it) and `.spin` (°/s) in the console
//   to lean, jolt or turn it.
// - the canvas's `clear()`, and drawing the app's one asset image (the
//   wooden base) from public/.
const stillWatch = `globalThis.__gea_Accelerometer = {
  feel: [0, 0, -9.80665],
  spin: [0, 0, 0],
  get accelerationX() { return this.feel[0]; },
  get accelerationY() { return this.feel[1]; },
  get accelerationZ() { return this.feel[2]; },
  get gyroscopeX() { return this.spin[0]; },
  get gyroscopeY() { return this.spin[1]; },
  get gyroscopeZ() { return this.spin[2]; },
  start() {},
};
CanvasRenderingContext2D.prototype.clear = function () {
  this.fillStyle = "#000";
  this.fillRect(0, 0, this.canvas.width, this.canvas.height);
};
const base = new Image();
base.src = "art/base.png";
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (image, ...rest) {
  const native = image instanceof HTMLImageElement || image instanceof HTMLCanvasElement || image instanceof ImageBitmap;
  if (native) drawImage.call(this, image, ...rest);
  else if (base.complete) drawImage.call(this, base, ...rest);
};`;

export default defineConfig({
  plugins: [
    {
      name: "still-watch",
      transformIndexHtml: () => [{ tag: "script", children: stillWatch, injectTo: "head-prepend" }],
    },
  ],
});

import { Store } from "@geastack/core";
import { DEFAULT_GLOBE, GLOBES } from "../lib/globes";

const PREFIX = "yule.";

// What the menu sets, kept on the watch (localStorage) across restarts.
class SettingsStore extends Store {
  globe = DEFAULT_GLOBE;
  track = 0;
  music = true;
  volume = 60; // 0..100
  wind = true;
  // Every CYCLE_MINUTES the next globe comes round by itself.
  cycle = false;

  load() {
    this.globe = Math.min(GLOBES.length - 1, readNumber("globe", DEFAULT_GLOBE));
    // A build with another DEFAULT_GLOBE shows it, whatever was picked before.
    if (readNumber("default", -1) !== DEFAULT_GLOBE) {
      write("default", DEFAULT_GLOBE);
      this.setGlobe(DEFAULT_GLOBE);
    }
    this.track = readNumber("track", 0);
    this.music = readNumber("music", 1) === 1;
    this.volume = readNumber("volume", 60);
    this.wind = readNumber("wind", 1) === 1;
    this.cycle = readNumber("cycle", 0) === 1;
  }

  setGlobe(globe: number) {
    this.globe = globe;
    write("globe", globe);
  }

  // The playlist's length is known once the card is read: a song that is no
  // longer there gives way to the music box.
  fitTrack(tracks: number) {
    if (this.track >= tracks) this.setTrack(0);
  }

  // Saves everything again. A save made in the same frame as reading a
  // globe from the card is lost on the watch; one a frame later is kept.
  resave() {
    write("saved", Date.now());
  }

  setTrack(track: number) {
    this.track = track;
    write("track", track);
  }

  setMusic(on: boolean) {
    this.music = on;
    write("music", on ? 1 : 0);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    write("volume", this.volume);
  }

  setWind(on: boolean) {
    this.wind = on;
    write("wind", on ? 1 : 0);
  }

  setCycle(on: boolean) {
    this.cycle = on;
    write("cycle", on ? 1 : 0);
  }
}

function readNumber(key: string, fallback: number): number {
  const text = localStorage.getItem(PREFIX + key);
  if (!text) return fallback;

  const value = Number(text);
  return Number.isNaN(value) ? fallback : value;
}

function write(key: string, value: number) {
  localStorage.setItem(PREFIX + key, `${value}`);
}

export const CYCLE_MINUTES = 5;
export const settings = new SettingsStore();

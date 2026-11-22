import { type AudioWorkletNode, audioContext, readCacheFile, readFileRange } from "@geastack/core";

// The songs on the card: 16 kHz mono 16-bit raw samples, listed one per
// line in the index as "file|title|performer" (scripts/push.sh puts them
// there). Each is split into PART_BYTES files, "<file>.0", "<file>.1"...:
// the watch takes a file pushed over USB whole into memory.
const FOLDER = "/sdcard/yule/music/";
const INDEX = "tracks.txt";
const PART_BYTES = 2097152;
const MUSIC_BOX = "Music box: Silent Night";
const LEAD = 24000; // samples kept queued ahead of the player (the ring holds 32768)
const CHUNK = 4096; // samples read and sent at a time

const WIND_PER_S = 1.1; // spring wound per second of a hard shake
const BOOT_WIND = 0.3; // enough for the first line as the globe appears
const SEND_S = 0.1; // wind messages to the audio thread at most this often
const TINKLE_AT = 0.55; // a shake this hard rings the glass
const TINKLE_S = 0.3;

// The playlist: the music box (track 0), wound by shaking the globe, then
// the card's songs, each streamed to the player (lib/player.worklet.ts) a
// chunk at a time and followed by the next.
export class Music {
  readonly titles: string[] = [MUSIC_BOX];
  readonly performers: string[] = ["Built in"];
  private readonly files: string[] = [""];
  private node: AudioWorkletNode | null = null;
  private opening = false;
  private on = false;
  private volume = 60;
  private track = 0;
  private sent = 0; // samples of the song sent
  private played = 0; // and played, as last reported
  private ended = false;
  private wound = 0;
  private sinceSend = 0;
  private sinceTinkle = TINKLE_S;
  // Called with the next track's number when a song ends.
  onTrack: (track: number) => void = () => {};

  // The card's songs, if any.
  list() {
    const index = readCacheFile(FOLDER + INDEX);
    let line = "";
    for (let i = 0; i < index.length; i++) {
      const c = index[i];
      if (c === 10) {
        this.add(line);
        line = "";
      } else if (c !== 13) {
        line += String.fromCharCode(c);
      }
    }
    this.add(line);
  }

  private add(line: string) {
    const parts = line.split("|");
    if (parts.length < 2 || !parts[0].endsWith(".raw")) return;

    this.files.push(FOLDER + parts[0]);
    this.titles.push(parts[1]);
    this.performers.push(parts.length > 2 ? parts[2] : "");
  }

  // The music as it was left; the audio thread starts only once music is
  // on.
  start(track: number, volume: number, on: boolean) {
    this.track = track;
    this.volume = volume;
    this.setOn(on);
  }

  // A touch may be what lets the browser start sound.
  wake() {
    if (this.node && this.on && audioContext.state !== "running") audioContext.resume();
  }

  // Off, the player falls silent. Its audio thread is made the first time
  // music is on, never before.
  setOn(on: boolean) {
    this.on = on;
    if (!this.node) {
      if (on) this.open();
      return;
    }

    if (on) this.play(this.track);
    else this.post("x");
  }

  private async open() {
    if (this.opening) return;

    this.opening = true;
    let node: AudioWorkletNode;
    try {
      await audioContext.audioWorklet.addModule(new URL("./player.worklet.ts", import.meta.url));
      node = new AudioWorkletNode(audioContext, "yule-player");
    } catch {
      // No audio thread: the browser preview's stand-in context has no
      // worklets, and the watch may lack the internal RAM for its stack.
      console.log("yule: no music (audio thread unavailable)");
      return;
    }

    node.connect(audioContext.destination);
    node.port.onmessage = (event) => {
      if (typeof event.data === "string" && event.data.charAt(0) === "c") this.played = Number(event.data.substring(1));
    };
    this.node = node;
    this.setVolume(this.volume);
    this.setOn(this.on);
  }

  // Volume 0..100.
  setVolume(volume: number) {
    this.volume = volume;
    this.post(`v${volume / 100}`);
  }

  play(track: number) {
    this.track = track < this.titles.length ? track : 0;
    if (!this.on) return;

    this.sent = 0;
    this.played = 0;
    this.ended = false;
    if (this.track === 0) {
      this.post("b");
      this.post(`w${BOOT_WIND}`);
    } else {
      this.post("s");
    }
    console.log(`yule: playing ${this.titles[this.track]}`);
  }

  update(dt: number, wind: number) {
    if (!this.node || !this.on) return;

    if (this.track === 0) this.wind(dt, wind);
    else this.feed();
    this.sinceTinkle += dt;
    if (wind >= TINKLE_AT && this.sinceTinkle >= TINKLE_S) {
      this.post(`t${Math.round(wind * 100) / 100}`);
      this.sinceTinkle = 0;
    }
  }

  private wind(dt: number, wind: number) {
    this.wound += wind * WIND_PER_S * dt;
    this.sinceSend += dt;
    if (this.wound > 0.01 && this.sinceSend >= SEND_S) {
      this.post(`w${Math.round(this.wound * 1000) / 1000}`);
      this.wound = 0;
      this.sinceSend = 0;
    }
  }

  // Keeps about a second of the song queued; once it has all played, on to
  // the next track.
  private feed() {
    const queued = this.sent - Math.min(this.played, this.sent);
    if (this.ended) {
      if (queued <= 0) this.next();
      return;
    }

    if (queued >= LEAD) return;

    const node = this.node;
    const at = this.sent * 2;
    const part = Math.floor(at / PART_BYTES);
    const inside = at - part * PART_BYTES;
    const wanted = Math.min(CHUNK * 2, PART_BYTES - inside);
    const bytes = readFileRange(`${this.files[this.track]}.${part}`, inside, wanted);
    const samples = bytes.length >> 1;
    if (samples > 0 && node) {
      const buffer: ArrayBuffer = bytes.buffer as ArrayBuffer;
      node.port.postMessage(buffer);
      this.sent += samples;
    }
    if (samples * 2 < wanted) this.ended = true;
  }

  // The next song, or the music box if this one could not be read.
  private next() {
    let track = this.track + 1 < this.titles.length ? this.track + 1 : 1;
    if (this.sent === 0) track = 0;
    this.play(track);
    this.onTrack(this.track);
  }

  private post(message: string) {
    const node = this.node;
    if (node) node.port.postMessage(message);
  }
}

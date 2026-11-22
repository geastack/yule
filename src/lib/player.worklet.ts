// The globe's music, on the audio thread: a clockwork music box playing
// "Silent Night" (Gruber, 1818; public domain), or a song streamed from the
// microSD card.
//
// Messages: "b" the music box, "s" a song (its 16 kHz mono 16-bit samples
// follow as ArrayBuffers; "c<count>" reports back how many were played),
// "x" silence, "v<level>" the volume (0..1). Shaking the globe winds the
// music box's spring ("w<amount>"); it plays while wound, slowing as it
// unwinds, and stops mid-tune when it runs down. Hard shakes add a glassy
// tinkle ("t<strength>") over either.
//
// Each pitch is rendered once, at load, into a table of 16-bit samples: a
// plucked steel tine is a few inharmonic partials decaying exponentially,
// plus a click. Playing is then only mixing table reads, in 32-bit integer
// maths.

// The tune in eighth notes (6/8): MIDI pitch, length. Under it, one chord
// per bar; the bass plays its root, then its fifth, a dotted quarter each.
const TUNE = [
  79, 3, 81, 1, 79, 2, 76, 6, 79, 3, 81, 1, 79, 2, 76, 6, 86, 4, 86, 2, 83, 6, 84, 4, 84, 2, 79, 6, 81, 4, 81, 2, 84, 3,
  83, 1, 81, 2, 79, 3, 81, 1, 79, 2, 76, 6, 81, 4, 81, 2, 84, 3, 83, 1, 81, 2, 79, 3, 81, 1, 79, 2, 76, 6, 86, 4, 86, 2,
  89, 3, 86, 1, 83, 2, 84, 6, 88, 6, 84, 3, 79, 1, 76, 2, 79, 3, 77, 1, 74, 2, 72, 12,
];
const CHORDS = "CCCCGGCCFCCCFCCCGGCCCGCC";
const ROOTS = "CFG";
const BASS = [60, 67, 65, 72, 67, 74]; // root, fifth of C, F, G
const TINKLES = [96, 98, 100, 103, 105, 108];
// The tine: partial ratio, level, decay time (s).
const PARTIALS = [1, 1, 1.6, 2, 0.32, 0.6, 5.4, 0.12, 0.09];
const NOTE_S = 1.1;
const TINKLE_S = 0.45;
const VOICES = 8;
const BLOCK = 128;
const LEVEL = 0.22; // one voice at full

// A song: a ring of samples about two seconds long, read at the song's rate
// whatever the output's (Q16 steps), played counts reported this often.
const SONG_RATE = 16000;
const RING = 32768;
const REPORT_S = 0.25;
const SONG_LEVEL = 0.9;

const EIGHTHS_PER_S = 3; // fully wound
const UNWIND_PER_S = 0.028; // a full wind plays about 35 s
const SLOWEST = 0.3; // tempo share left as the spring runs down

class Player extends AudioWorkletProcessor {
  private readonly tables: Int16Array[] = [];
  private readonly pitches: number[] = [];
  private readonly voiceTable = new Int32Array(VOICES);
  private readonly voicePosition = new Int32Array(VOICES);
  private readonly voiceGain = new Int32Array(VOICES);
  private readonly mix = new Int32Array(BLOCK);
  private nextVoice = 0;
  private spring = 0;
  private beat = 0; // eighths into the tune
  private note = 0; // next tune note
  private noteAt = 0; // eighth it starts on
  private eighth = 0; // next eighth to sound
  private seed = 0x1234567;
  private box = true;
  private song = false;
  private volume = 1;
  private readonly ring = new Int16Array(RING);
  private written = 0; // samples into the ring, all told
  private read = 0; // samples out of it, all told
  private fraction = 0; // Q16 between `read` and the next
  private step = 65536;
  private reported = 0;
  private sinceReport = 0;

  constructor() {
    super();
    for (let i = 0; i < VOICES; i++) this.voiceTable[i] = -1;
    for (let i = 0; i < TUNE.length; i += 2) this.table(TUNE[i], NOTE_S);
    for (let i = 0; i < BASS.length; i++) this.table(BASS[i], NOTE_S);
    for (let i = 0; i < TINKLES.length; i++) this.table(TINKLES[i], TINKLE_S);
    this.step = Math.round((SONG_RATE / sampleRate) * 65536);
    this.port.onmessage = (event) => {
      if (typeof event.data === "string") this.message(event.data);
      else this.queue(new Int16Array(event.data));
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0][0];
    const frames = out.length;
    if (this.box) this.play(frames / sampleRate);

    const mix = this.mix;
    for (let i = 0; i < frames; i++) mix[i] = 0;
    for (let v = 0; v < VOICES; v++) this.add(v, frames);
    if (this.song) this.stream(frames);
    const scale = (this.volume * LEVEL) / (32768 * 256);
    for (let i = 0; i < frames; i++) out[i] = mix[i] * scale;
    this.report(frames / sampleRate);
    return true;
  }

  // The song's next samples into the mix, at the music box's scale.
  private stream(frames: number) {
    const mix = this.mix;
    const ring = this.ring;
    const gain: i32 = Math.round((SONG_LEVEL / LEVEL) * 256);
    const step: i32 = this.step;
    let read: i32 = this.read;
    let fraction: i32 = this.fraction;
    const end: i32 = this.written;
    for (let i: i32 = 0; i < frames && read < end; i++) {
      mix[i] += ring[read & (RING - 1)] * gain;
      fraction += step;
      read += fraction >> 16;
      fraction &= 65535;
    }
    this.read = Math.min(read, end);
    this.fraction = fraction;
  }

  private queue(samples: Int16Array) {
    const ring = this.ring;
    const count: i32 = samples.length;
    let at: i32 = this.written;
    for (let i: i32 = 0; i < count; i++) {
      ring[at & (RING - 1)] = samples[i];
      at++;
    }
    this.written = at;
  }

  // How far into the song, now and then, so the sender keeps ahead.
  private report(seconds: number) {
    this.sinceReport += seconds;
    if (!this.song || this.sinceReport < REPORT_S || this.read === this.reported) return;

    this.sinceReport = 0;
    this.reported = this.read;
    this.port.postMessage(`c${this.read}`);
  }

  private message(text: string) {
    const kind = text.charAt(0);
    const amount = Number(text.substring(1));
    if (kind === "b" || kind === "s" || kind === "x") {
      this.box = kind === "b";
      this.song = kind === "s";
      this.spring = 0;
      this.written = 0;
      this.read = 0;
      this.fraction = 0;
      this.reported = 0;
    } else if (kind === "v") {
      this.volume = amount;
    } else if (kind === "w") {
      if (!this.box) return;

      if (this.spring <= 0) this.restart();
      this.spring = Math.min(1, this.spring + amount);
    } else if (kind === "t") {
      for (let k = 0; k < 3; k++) {
        const pitch = TINKLES[this.random() % TINKLES.length];
        this.strike(pitch, 0.25 + 0.35 * amount * (1 - k * 0.3));
      }
    }
  }

  // Advances the tune by `seconds`, striking the notes it reaches.
  private play(seconds: number) {
    if (this.spring <= 0) return;

    const tempo = EIGHTHS_PER_S * (SLOWEST + (1 - SLOWEST) * Math.sqrt(this.spring));
    this.beat += seconds * tempo;
    this.spring = Math.max(0, this.spring - seconds * UNWIND_PER_S);
    while (this.beat >= this.eighth) {
      if (this.note * 2 >= TUNE.length) {
        this.restart();
        return;
      }

      const eighth = this.eighth;
      if (eighth % 3 === 0) {
        const chord = ROOTS.indexOf(CHORDS.charAt(Math.floor(eighth / 6) % CHORDS.length));
        this.strike(BASS[chord * 2 + ((eighth / 3) % 2)], 0.5);
      }
      if (eighth === this.noteAt) {
        this.strike(TUNE[this.note * 2], 1);
        this.noteAt += TUNE[this.note * 2 + 1];
        this.note++;
      }
      this.eighth++;
    }
  }

  private restart() {
    this.beat = 0;
    this.note = 0;
    this.noteAt = 0;
    this.eighth = 0;
  }

  // A tine plucked: the next voice plays the pitch's table.
  private strike(pitch: number, level: number) {
    const v = this.nextVoice;
    this.nextVoice = (v + 1) % VOICES;
    this.voiceTable[v] = this.pitches.indexOf(pitch);
    this.voicePosition[v] = 0;
    this.voiceGain[v] = Math.round(level * 256);
  }

  private add(v: number, frames: number) {
    const which = this.voiceTable[v];
    if (which < 0) return;

    const table = this.tables[which];
    const mix = this.mix;
    const gain: i32 = this.voiceGain[v];
    const from: i32 = this.voicePosition[v];
    const count: i32 = Math.min(frames, table.length - from);
    for (let i: i32 = 0; i < count; i++) mix[i] += table[from + i] * gain;
    this.voicePosition[v] = from + count;
    if (from + count >= table.length) this.voiceTable[v] = -1;
  }

  // Renders `pitch` once: each partial a damped resonator in Q14, run as
  // y[n] = c y[n-1] - d y[n-2], started by an impulse, plus a short click.
  private table(pitch: number, seconds: number) {
    if (this.pitches.indexOf(pitch) >= 0) return;

    const length = Math.round(seconds * sampleRate);
    const table = new Int16Array(length);
    const sum = new Int32Array(length);
    const hz = 440 * 2 ** ((pitch - 69) / 12);
    for (let p = 0; p < PARTIALS.length; p += 3) {
      const w = (2 * Math.PI * hz * PARTIALS[p]) / sampleRate;
      if (w >= Math.PI * 0.9) continue;

      const r = Math.exp(-1 / (PARTIALS[p + 2] * sampleRate));
      this.resonate(
        sum,
        Math.round(2 * r * Math.cos(w) * 16384),
        Math.round(r * r * 16384),
        Math.round(PARTIALS[p + 1] * Math.sin(w) * 9000),
      );
    }
    const click = Math.round(0.004 * sampleRate);
    for (let i = 0; i < Math.min(click, length); i++) sum[i] += (((this.random() % 1200) - 600) * (click - i)) / click;
    const fade = Math.round(0.08 * sampleRate);
    for (let i = 0; i < length; i++) {
      const tail = length - i < fade ? (length - i) / fade : 1;
      table[i] = Math.max(-32767, Math.min(32767, sum[i] * tail));
    }
    this.pitches.push(pitch);
    this.tables.push(table);
  }

  private resonate(sum: Int32Array, c: i32, d: i32, start: i32) {
    let y1: i32 = start;
    let y2: i32 = 0;
    const length: i32 = sum.length;
    for (let i: i32 = 0; i < length; i++) {
      sum[i] += y1;
      const y: i32 = ((c * y1) >> 14) - ((d * y2) >> 14);
      y2 = y1;
      y1 = y;
    }
  }

  private random(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x;
    return x >>> 0;
  }
}

registerProcessor("yule-player", Player);

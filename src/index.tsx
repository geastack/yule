import { Display, mount } from "@geastack/core";
import "./styles/fonts.css";
import { App } from "./app";
import { yule } from "./lib/yule";
import { trackChanged } from "./navigation";

Display.setAA(4);
Display.setFrameRate(60);
// Every frame is one full-panel blit: send it in the largest chunks the
// display's transfer pool holds (flushPoolBytes in package.json; it is
// internal RAM, which reading the card and the audio thread need too).
Display.setFlushConfig({ rows: 20, depth: 2 });
mount(App);
yule.music.onTrack = (track) => trackChanged(track);
yule.start();

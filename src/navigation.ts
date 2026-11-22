import { GLOBES } from "./lib/globes";
import { yule } from "./lib/yule";
import { GLOBES_PAGE, HOME, MUSIC_PAGE, menu, NONE, ROWS, type Row, SETTINGS_PAGE } from "./stores/menu";
import { settings } from "./stores/settings";

const ESCAPE_KEY = 27;
const VOLUME_STEP = 10;

// The menu over the globe: opened by a tap on the wooden base or the USER
// button (which also steps back), and the globe paused while it is open.

export function openMenu() {
  yule.pause(true);
  menu.open(HOME, 0, 0);
}

export function closeMenu() {
  menu.close();
  yule.pause(false);
}

export function back(keyCode: number) {
  if (keyCode !== ESCAPE_KEY) return;

  if (menu.page === NONE) openMenu();
  else if (menu.page === HOME) closeMenu();
  else menu.open(HOME, 0, 0);
}

export function showGlobes() {
  menu.open(GLOBES_PAGE, GLOBES.length, pageOf(settings.globe));
  listRows();
}

export function showMusic() {
  menu.open(MUSIC_PAGE, yule.music.titles.length, pageOf(settings.track));
  listRows();
}

export function showSettings() {
  menu.open(SETTINGS_PAGE, 0, 0);
}

export function turn(by: number) {
  menu.turn(by);
  listRows();
}

// A row tapped: the globe shows, or the song plays.
export function pick(item: number) {
  if (item < 0) return;

  if (menu.page === GLOBES_PAGE) {
    yule.showGlobe(item);
    closeMenu();
    return;
  }

  settings.setTrack(item);
  if (!settings.music) {
    settings.setMusic(true);
    yule.music.setOn(true);
  }
  yule.music.play(item);
  listRows();
}

export function toggleMusic() {
  settings.setMusic(!settings.music);
  yule.music.setOn(settings.music);
}

export function changeVolume(by: number) {
  settings.setVolume(settings.volume + by * VOLUME_STEP);
  yule.music.setVolume(settings.volume);
}

export function toggleWind() {
  settings.setWind(!settings.wind);
  yule.setWind(settings.wind);
}

export function toggleCycle() {
  settings.setCycle(!settings.cycle);
}

// The playlist moved on by itself.
export function trackChanged(track: number) {
  settings.setTrack(track);
  if (menu.page === MUSIC_PAGE) listRows();
}

function pageOf(item: number): number {
  return Math.floor(item / ROWS) * ROWS;
}

// The open list's rows on show: always ROWS of them, the ones past the end
// blank, so the page only ever changes what its rows say.
function listRows() {
  const rows: Row[] = [];
  for (let item = menu.first; item < menu.first + ROWS; item++) {
    if (item >= menu.count) {
      rows.push({ item: -1, title: "", detail: "", on: false });
    } else if (menu.page === GLOBES_PAGE) {
      const globe = GLOBES[item];
      rows.push({ item, title: globe.name, detail: globe.style, on: item === settings.globe });
    } else {
      const music = yule.music;
      rows.push({ item, title: music.titles[item], detail: music.performers[item], on: item === settings.track });
    }
  }
  menu.show(rows);
}

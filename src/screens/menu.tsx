import "../styles/menu.css";
import { GLOBES } from "../lib/globes";
import { yule } from "../lib/yule";
import {
  changeVolume,
  closeMenu,
  pick,
  showGlobes,
  showMusic,
  showSettings,
  toggleCycle,
  toggleMusic,
  toggleWind,
  turn,
} from "../navigation";
import { HOME, menu, ROWS } from "../stores/menu";
import { CYCLE_MINUTES, settings } from "../stores/settings";

function Header({ title }: { title: string }) {
  return (
    <div class="header">
      <div class="back" onClick={() => menu.open(HOME, 0, 0)}>
        <span class="t-button">Back</span>
      </div>
      <span class="t-heading">{title}</span>
    </div>
  );
}

// The menu: the three lists, and back to the globe.
export function HomePage() {
  const playing = settings.music ? yule.music.titles[settings.track] : "Off";
  return (
    <div class="page">
      <div class="home-title">
        <span class="t-title">Yule</span>
        <span class="t-detail">Snow globes</span>
      </div>
      <div class="entry" onClick={() => showGlobes()}>
        <span class="t-entry">Snow globes</span>
        <span class="t-detail">{GLOBES[settings.globe].name}</span>
      </div>
      <div class="entry" onClick={() => showMusic()}>
        <span class="t-entry">Music</span>
        <span class="t-detail">{playing}</span>
      </div>
      <div class="entry" onClick={() => showSettings()}>
        <span class="t-entry">Settings</span>
        <span class="t-detail">Music, volume, wind</span>
      </div>
      <div class="done" onClick={() => closeMenu()}>
        <span class="t-button-dark">Back to the globe</span>
      </div>
    </div>
  );
}

// A page of globes or songs; the chosen one is marked. The page is mounted
// afresh whenever its rows change (see App): on the watch a mounted list
// does not redraw its rows.
export function ListPage({ title }: { title: string }) {
  const page = Math.floor(menu.first / ROWS) + 1;
  const pages = Math.max(1, Math.ceil(menu.count / ROWS));
  return (
    <div class="page">
      <Header title={title} />
      <div class="rows">
        {menu.rows.map((row) => (
          <div class={row.item < 0 ? "row row-blank" : row.on ? "row row-on" : "row"} onClick={() => pick(row.item)}>
            <div class={row.on ? "mark mark-on" : "mark"} />
            <div class="row-text">
              <span class={row.on ? "t-entry t-gold" : "t-entry"}>{row.title}</span>
              <span class="t-detail">{row.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div class="pager">
        <div class={page > 1 ? "turn" : "turn turn-off"} onClick={() => turn(-1)}>
          <span class="t-button">Prev</span>
        </div>
        <span class="t-detail">{`${page} / ${pages}`}</span>
        <div class={page < pages ? "turn" : "turn turn-off"} onClick={() => turn(1)}>
          <span class="t-button">Next</span>
        </div>
      </div>
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <div class={on ? "switch switch-on" : "switch"}>
      <span class={on ? "t-button-dark" : "t-button"}>{on ? "On" : "Off"}</span>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div class="page">
      <Header title="Settings" />
      <div class="setting" onClick={() => toggleMusic()}>
        <span class="t-entry">Music</span>
        <Switch on={settings.music} />
      </div>
      <div class="setting">
        <span class="t-entry">Volume</span>
        <div class="stepper">
          <div class="step" onClick={() => changeVolume(-1)}>
            <span class="t-button">-</span>
          </div>
          <span class="t-entry">{`${settings.volume}`}</span>
          <div class="step" onClick={() => changeVolume(1)}>
            <span class="t-button">+</span>
          </div>
        </div>
      </div>
      <div class="setting" onClick={() => toggleWind()}>
        <span class="t-entry">Wind</span>
        <Switch on={settings.wind} />
      </div>
      <div class="setting" onClick={() => toggleCycle()}>
        <span class="t-entry">{`New globe every ${CYCLE_MINUTES} min`}</span>
        <Switch on={settings.cycle} />
      </div>
    </div>
  );
}

import "../styles/menu.css";
import { GLOBES } from "../lib/globes";
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
import { GLOBES_PAGE, HOME, menu, ROWS } from "../stores/menu";
import { CYCLE_MINUTES, settings } from "../stores/settings";

function Header({ title }: { title: string }) {
  return (
    <div class="menu-header">
      <span class="menu-heading">{title}</span>
      <div class="menu-back" onClick={() => menu.open(HOME, 0, 0)}>
        <span class="menu-control">Menu</span>
      </div>
    </div>
  );
}

export function HomePage() {
  const globe = GLOBES[settings.globe];
  return (
    <div class="menu-page menu-home">
      <span class="menu-title">Yule</span>
      <div class="menu-illustration">
        <div class="menu-rule" />
        <div class="menu-frame">
          <img class="menu-hero-art" src={`/art/menu/${globe.id}.jpg`} />
        </div>
        <div class="menu-rule" />
      </div>
      <span class="menu-caption">{globe.name}</span>
      <div class="menu-home-actions">
        <div class="menu-browse" onClick={() => showGlobes()}>
          <span class="menu-primary-label">Browse snow globes</span>
        </div>
        <div class="menu-secondary">
          <div class="menu-link" onClick={() => showMusic()}>
            <span class="menu-control">Music</span>
          </div>
          <div class="menu-link" onClick={() => showSettings()}>
            <span class="menu-control">Settings</span>
          </div>
        </div>
      </div>
      <div class="menu-done" onClick={() => closeMenu()}>
        <span class="menu-return">Back to the globe</span>
      </div>
    </div>
  );
}

// The watch remounts a list page whenever its rows change (see App).
export function ListPage({ title }: { title: string }) {
  const page = Math.floor(menu.first / ROWS) + 1;
  const pages = Math.max(1, Math.ceil(menu.count / ROWS));
  const globes = menu.page === GLOBES_PAGE;
  return (
    <div class="menu-page">
      <Header title={title} />
      <div class="menu-rows">
        {menu.rows.map((row) => (
          <div
            class={row.item < 0 ? "menu-row menu-row-blank" : row.on ? "menu-row menu-row-on" : "menu-row"}
            onClick={() => pick(row.item)}
          >
            {globes && row.item >= 0 ? (
              <img class="menu-thumbnail" src={`/art/menu/${GLOBES[row.item].id}.jpg`} />
            ) : null}
            <div class="menu-item-text">
              <span class="menu-item-title">{row.title}</span>
              <span class="menu-detail">{row.detail}</span>
            </div>
            {!globes || row.on ? (
              <span class="menu-row-status">{globes ? "Current" : row.on ? "Replay" : "Play"}</span>
            ) : null}
          </div>
        ))}
      </div>
      {pages > 1 ? (
        <div class="menu-pager">
          <div class={page > 1 ? "menu-turn" : "menu-turn menu-turn-off"} onClick={() => turn(-1)}>
            <span class="menu-control">Previous</span>
          </div>
          <span class="menu-detail">{`${page} / ${pages}`}</span>
          <div class={page < pages ? "menu-turn" : "menu-turn menu-turn-off"} onClick={() => turn(1)}>
            <span class="menu-control">Next</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <div class={on ? "menu-switch menu-switch-on" : "menu-switch"}>
      <span class="menu-control">{on ? "On" : "Off"}</span>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div class="menu-page">
      <Header title="Settings" />
      <div class="menu-settings">
        <div class="menu-setting" onClick={() => toggleMusic()}>
          <span class="menu-item-title">Music</span>
          <Switch on={settings.music} />
        </div>
        <div class="menu-setting">
          <span class="menu-item-title">Volume</span>
          <div class="menu-stepper">
            <div class="menu-step" onClick={() => changeVolume(-1)}>
              <span class="menu-control">−</span>
            </div>
            <span class="menu-volume">{`${settings.volume}%`}</span>
            <div class="menu-step" onClick={() => changeVolume(1)}>
              <span class="menu-control">+</span>
            </div>
          </div>
        </div>
        <div class="menu-setting" onClick={() => toggleWind()}>
          <span class="menu-item-title">Wind</span>
          <Switch on={settings.wind} />
        </div>
        <div class="menu-setting" onClick={() => toggleCycle()}>
          <div class="menu-item-text">
            <span class="menu-item-title">Rotate snow globes</span>
            <span class="menu-detail">{`Every ${CYCLE_MINUTES} minutes`}</span>
          </div>
          <Switch on={settings.cycle} />
        </div>
      </div>
    </div>
  );
}

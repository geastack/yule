import { ReactiveComponent } from "@geastack/core";
import "./styles/app.css";
import { PANEL_H, PANEL_W } from "./lib/frame";
import { CANVAS_ID, yule } from "./lib/yule";
import { back, openMenu } from "./navigation";
import { HomePage, ListPage, SettingsPage } from "./screens/menu";
import { GLOBES_PAGE, HOME, MUSIC_PAGE, menu, SETTINGS_PAGE } from "./stores/menu";

// One full-panel canvas, presenting straight to the display with nothing
// over it; a menu page covers it only while the globe is paused. The USER
// button arrives as a key: it opens the menu and steps back through it.
export class App extends ReactiveComponent {
  template() {
    return (
      <div class="app" style={{ width: PANEL_W, height: PANEL_H }} onKeyDown={(event) => back(event.keyCode)}>
        <canvas
          id={CANVAS_ID}
          class="globe"
          width={PANEL_W}
          height={PANEL_H}
          onPointerDown={(event) => yule.down(event.pointerId, event.clientX, event.clientY)}
          onPointerMove={(event) => yule.move(event.pointerId, event.clientX, event.clientY)}
          onPointerUp={(event) => {
            if (yule.up(event.pointerId)) openMenu();
          }}
        />
        {menu.page === HOME ? <HomePage /> : null}
        {menu.page === GLOBES_PAGE && menu.flip ? <ListPage title="Snow globes" /> : null}
        {menu.page === GLOBES_PAGE && !menu.flip ? <ListPage title="Snow globes" /> : null}
        {menu.page === MUSIC_PAGE && menu.flip ? <ListPage title="Music" /> : null}
        {menu.page === MUSIC_PAGE && !menu.flip ? <ListPage title="Music" /> : null}
        {menu.page === SETTINGS_PAGE ? <SettingsPage /> : null}
      </div>
    );
  }
}

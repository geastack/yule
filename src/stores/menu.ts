import { Store } from "@geastack/core";

// Page ids: the globe itself (no page), the menu, and its three lists.
export const NONE = 0;
export const HOME = 1;
export const GLOBES_PAGE = 2;
export const MUSIC_PAGE = 3;
export const SETTINGS_PAGE = 4;

// Rows a list page shows at a time.
export const ROWS = 5;

// One row of a list page: what it shows and which item it picks.
export type Row = {
  item: number;
  title: string;
  detail: string;
  on: boolean;
};

const BLANK: Row = { item: -1, title: "", detail: "", on: false };

// Which page is open over the globe, and which rows of its list show
// (always ROWS of them).
class MenuStore extends Store {
  page = NONE;
  first = 0; // the first item shown
  count = 0; // items in the open list
  rows: Row[] = [BLANK, BLANK, BLANK, BLANK, BLANK];
  // Flips whenever the rows change, so the list page is mounted afresh.
  flip = false;

  open(page: number, count: number, first: number) {
    this.page = page;
    this.count = count;
    this.first = first;
  }

  close() {
    this.page = NONE;
  }

  turn(by: number) {
    const first = this.first + by * ROWS;
    if (first < 0 || first >= this.count) return;

    this.first = first;
  }

  show(rows: Row[]) {
    this.rows = rows;
    this.flip = !this.flip;
  }
}

export const menu = new MenuStore();

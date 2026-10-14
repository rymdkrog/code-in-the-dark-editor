// The Core-to-Enhancement interface: one-way `CustomEvent`s on `window`. The Core publishes them
// whether or not anyone listens, and the Enhancement never commands the Core.

/** The Contestant's name, as `detail`: once it is known on start, and after every change. */
export const NAME_CHANGED = "citd:name-changed";
/** This laptop's seat id for the Round, as `detail`, once the editor starts. */
export const SEAT = "citd:seat";
/** No `detail`. The Round is open in another tab, so this one never starts and doesn't connect. */
export const TWO_TAB_BLOCKED = "citd:two-tab-blocked";

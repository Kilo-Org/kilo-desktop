import { createBrowserMainEntry } from "./entry.js";

export { createBrowserMainEntry, type BrowserMainOptions } from "./entry.js";
export type { BrowserHost, GuestController, GuestState } from "./browser-host.js";

/** kilo.browser's main entry, on the desktop host's embedded browser. */
export const browserMainEntry = createBrowserMainEntry();

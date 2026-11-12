import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The side menu's workspace filter, in an app of its own: this registers a
 * workspace and leaves its settings dialog open, which no other spec wants.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-folders",
});

export const { expect } = test;

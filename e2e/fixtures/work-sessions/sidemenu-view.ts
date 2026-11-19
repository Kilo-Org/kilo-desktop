import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The side menu's view options, in an app of its own: this seeds sessions and
 * leaves the list sorted by title, which the new-account specs' empty list and
 * every recency-ordered spec would contradict.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-view",
});

export const { expect } = test;

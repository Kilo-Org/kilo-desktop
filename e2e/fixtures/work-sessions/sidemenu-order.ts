import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The order the session commands follow, in an app of its own: these seed,
 * pin and archive sessions, which the new-account specs' empty list and the
 * row specs' single session would both contradict.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-order",
});

export const { expect } = test;

import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The session search's results, in an app of its own: it needs a workspace and
 * sessions both inside and outside it, which no other spec wants to find.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-search",
});

export const { expect } = test;

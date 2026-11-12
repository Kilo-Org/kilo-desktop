import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The side menu with a history too long to fit the window, in an app of its
 * own: the seeded sessions would make every other spec's assertions ambiguous.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-many",
});

export const { expect } = test;

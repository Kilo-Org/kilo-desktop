import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The delete confirmation, in an app of its own: it seeds two sessions and
 * leaves one behind, which the row specs delete by a title they own.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-delete",
});

export const { expect } = test;

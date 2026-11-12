import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The side menu's bulk actions, in an app of its own: the sessions this seeds
 * and archives would contradict the new-account specs' empty list.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-bulk",
});

export const { expect } = test;

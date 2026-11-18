import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The side menu's workspace filter and row edge cases, in an app of its own:
 * the workspace and sessions this seeds would contradict the new-account
 * specs' empty list.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-filter",
});

export const { expect } = test;

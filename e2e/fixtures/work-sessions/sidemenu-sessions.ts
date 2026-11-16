import { test as sidemenuTest } from "./sidemenu.js";

/**
 * The side menu once it holds sessions. A separate app from the sidemenu
 * fixture, whose specs assert an empty list.
 */
export const test = sidemenuTest.extend({
	appIsolationKey: "sidemenu-sessions",
});

export const { expect } = test;

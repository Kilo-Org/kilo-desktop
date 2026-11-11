import { SidemenuPage } from "../../pages/work-sessions/sidemenu-page.js";
import { SIGNED_OUT_LAUNCH_ENV } from "../../testdata/account.js";
import { test as workSessionsTest } from "../work-sessions.js";

/**
 * The side menu on a fresh profile: its own app, so the specs can assert an
 * empty session list rather than whatever ran before them. The session list
 * and New Session page come from the base fixture.
 *
 * Launched signed out, which is what "a newly created account" means here —
 * packaged e2e builds otherwise report kilo.core's fixed signed-in identity,
 * and the footer would show the account dock instead of Sign in.
 */
export const test = workSessionsTest.extend<{ sidemenuPage: SidemenuPage }>({
	appIsolationKey: "sidemenu",
	appLaunchEnv: SIGNED_OUT_LAUNCH_ENV,
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	sidemenuPage: async ({}, use) => {
		await use(new SidemenuPage());
	},
});

export const { expect } = test;

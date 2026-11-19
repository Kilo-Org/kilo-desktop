import { test } from "../../fixtures/browser.js";

// Own worker app so the guard capture runs before the host's one-time
// initialize(); a shared key could let a sibling spec register the guard first.
test.use({ appIsolationKey: "browser-loopback" });

test.describe("Browser loopback guard @smoke @packaged", () => {
	test("blocks a remote page from embedding a loopback sub-resource", async ({
		appShellPage,
		browserPage,
		browserGuestSessionPage,
	}) => {
		test.slow();
		await appShellPage.verifyShellIsLoaded();
		// Must precede startBrowserSession(), which triggers the host's initialize().
		await browserGuestSessionPage.captureNetworkGuardBeforeFirstPane();
		await browserPage.startBrowserSession();
		await browserGuestSessionPage.verifyRemoteEmbeddedLoopbackSubResourceIsCancelled();
		await browserGuestSessionPage.verifyLoopbackMainFrameNavigationIsAllowed();
	});
});

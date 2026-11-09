import { createServer } from "node:http";

import { test } from "../../../fixtures/features/browser.js";

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

	test("navigates directly to a loopback dev server and adopts its title", async ({
		appShellPage,
		browserPage,
	}) => {
		// The guard must not break a direct top-level navigation to a dev server.
		test.slow();
		const server = createServer((_request, response) => {
			response.setHeader("Content-Type", "text/html");
			response.end("<!doctype html><title>Loopback Dev Server</title><main>Local dev</main>");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Loopback server did not bind.");
			await appShellPage.verifyShellIsLoaded();
			await browserPage.startBrowserSession();
			await browserPage.navigate(`127.0.0.1:${address.port}`);
			await browserPage.verifyLoaded("Loopback Dev Server");
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
});

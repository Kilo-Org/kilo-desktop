import { createServer } from "node:http";

import { test } from "../../../fixtures/features/browser.js";

test.describe("Browser tab @smoke @packaged", () => {
	test("navigates an embedded guest and adopts its page title", async ({
		appShellPage,
		browserPage,
	}) => {
		// First browser-pane spec on a cold runner pays for the browser guest session
		// and partition init before the title
		// assertion clock starts. Retries succeed in ~half the budget, so grant this
		// spec a wider window instead of leaving it as the run's flake magnet.
		test.slow();
		const server = createServer((_request, response) => {
			response.setHeader("Content-Type", "text/html");
			response.end("<!doctype html><title>Browser Smoke Page</title><main>Loaded</main>");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Loopback server did not bind.");
			await appShellPage.verifyShellIsLoaded();
			await browserPage.startBrowserSession();
			await browserPage.navigate(`127.0.0.1:${address.port}`);
			await browserPage.verifyLoaded("Browser Smoke Page");
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
});

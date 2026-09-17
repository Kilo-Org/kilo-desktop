import { createServer } from "node:http";

import { test } from "../../../fixtures/features/browser.js";

test.describe("Chat browser tab @smoke", () => {
	test("navigates an embedded guest and adopts its page title", async ({
		appShellPage,
		browserPage,
		browserWorkspace,
	}) => {
		const server = createServer((_request, response) => {
			response.setHeader("Content-Type", "text/html");
			response.end("<!doctype html><title>Browser Smoke Page</title><main>Loaded</main>");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Loopback server did not bind.");
			await appShellPage.verifyShellIsLoaded();
			await browserPage.createAndSelectWorkspace(browserWorkspace.path, browserWorkspace.name);
			await browserPage.openBrowserTab();
			await browserPage.navigate(`127.0.0.1:${address.port}`);
			await browserPage.verifyLoaded("Browser Smoke Page");
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
});

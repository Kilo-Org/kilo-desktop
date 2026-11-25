import { createServer } from "node:http";

import { test } from "../../fixtures/marketplace.js";
import { KILO_GATEWAY_STUB_URL_ENV } from "../../utils/app-launcher.js";
import { packagedServerLine } from "../../utils/kilo-server-line.js";

/**
 * A fake Kilo Marketplace. The v1 CLI reads it from `KILO_MARKETPLACE_BASE_URL`
 * (`/mcps`); Kilo v2 reads `/api/marketplace/mcps` on its Kilo API server, so
 * on v2 this stands in for the whole Kilo API (`KILO_API_URL`) and answers
 * every other route with 404, which a signed-out server tolerates.
 */
const server = createServer((request, response) => {
	response.setHeader("content-type", "application/json");
	if (request.url === "/mcps" || request.url === "/api/marketplace/mcps") {
		response.end(
			JSON.stringify({
				items: [
					{
						id: "local-tools",
						name: "Local Tools",
						description: "A deterministic test MCP",
						category: "testing",
						url: "https://github.com/example/local-tools",
						content: JSON.stringify({
							command: "node",
							args: ["local-tools.js"],
						}),
					},
				],
			}),
		);
		return;
	}
	if (request.url?.startsWith("/api/") && !request.url.startsWith("/api/marketplace/")) {
		response.statusCode = 404;
		response.end(JSON.stringify({ error: "Not served by the e2e marketplace" }));
		return;
	}
	response.end(JSON.stringify({ items: [] }));
});
await new Promise<void>((resolve, reject) => {
	server.once("listening", resolve);
	server.once("error", reject);
	server.listen(0, "127.0.0.1");
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Marketplace fixture failed to bind.");

test.use({
	appIsolationKey: "kilo-marketplace",
	appLaunchEnv: {
		KILO_MARKETPLACE_BASE_URL: `http://127.0.0.1:${address.port}`,
		...(packagedServerLine() === "v2"
			? { [KILO_GATEWAY_STUB_URL_ENV]: `http://127.0.0.1:${address.port}` }
			: {}),
	},
});

test.afterAll(() => {
	server.closeAllConnections();
	server.close();
});

test.describe("Agent Behavior settings @smoke", () => {
	test("installs and removes a global MCP", async ({ appShellPage, marketplacePage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await marketplacePage.openFromSettings();
		await marketplacePage.installGlobalMcp("node local-tools.js");
		await marketplacePage.removeGlobalMcp();
		await appShellPage.leaveSettings();
	});
});

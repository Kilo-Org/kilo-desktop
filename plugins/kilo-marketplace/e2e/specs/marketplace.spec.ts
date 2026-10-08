import { createServer } from "node:http";

import { test } from "../fixtures.js";

const server = createServer((request, response) => {
	response.setHeader("content-type", "application/json");
	if (request.url === "/mcps") {
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

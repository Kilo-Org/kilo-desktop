import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { kilo2Executable, startKilo2, type Kilo2 } from "../../testing/kilo2.js";
import { KiloConfigManager } from "./KiloConfigManager.js";
import { createServerClient, locationPluginsReady } from "./server-client.js";

const SOURCE = "acme.tools/mcp";

describe.skipIf(!kilo2Executable)("Desktop's config file in the bundled kilo2", () => {
	let kilo: Kilo2 | undefined;

	afterEach(async () => {
		await kilo?.stop();
		kilo = undefined;
	});

	it("is read as a config layer: its MCP servers and agents reach the server", async () => {
		kilo = await startKilo2({
			before: async (home) => {
				const config = new KiloConfigManager(path.join(home, "runtime", "config", "kilo2"));
				await config.setEntry("mcp", SOURCE, "acme", {
					type: "local",
					command: ["acme-mcp"],
					disabled: true,
				});
				await config.setEntry("agent", SOURCE, "acme-reviewer", {
					description: "Reviews Acme code",
					system: "You review Acme code.",
					mode: "subagent",
				});
			},
		});
		const client = createServerClient(kilo.connection);
		const location = { location: { directory: kilo.home } };
		await locationPluginsReady(client, kilo.home);

		const servers = await client.mcp.list(location);
		const agents = await client.agent.list(location);

		expect(servers.data.map((server) => server.name)).toContain("acme");
		expect(agents.data.map((agent) => agent.id)).toContain("acme-reviewer");
	});
});

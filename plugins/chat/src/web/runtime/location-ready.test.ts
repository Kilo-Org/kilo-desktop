import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import { fetchCommandCatalogForConnection } from "../slash-commands/use-kilo-command-catalog";
import { fetchAgentCatalogForConnection } from "../selection/use-kilo-agent-catalog";
import { createKiloClient } from "./kilo-client";
import { locationReady } from "./location-ready";

afterEach(() => {
	vi.unstubAllGlobals();
});

function startingServer(polls: number) {
	const server = new FakeKilo2Server();
	server.startingPolls = polls;
	server.install();
	return server;
}

describe("catalogs read while a Kilo location is still starting", () => {
	it("lists every agent once the location's plugins have loaded", async () => {
		const server = startingServer(2);

		const catalog = await fetchAgentCatalogForConnection(server.connection);

		expect(catalog.agents.map((agent) => agent.name)).toEqual(["code", "plan", "ask", "debug"]);
	});

	it("lists the location's commands once its plugins have loaded", async () => {
		const server = startingServer(2);

		const commands = await fetchCommandCatalogForConnection(server.connection, "/projects/app");

		expect(commands.map((command) => command.name)).toEqual(["review"]);
	});
});

describe("locationReady", () => {
	it("resolves at once for a location whose plugins are listed", async () => {
		const server = startingServer(0);

		await locationReady(createKiloClient(server.connection), "/projects/app");

		expect(server.startingPolls).toBe(0);
	});

	it("gives up after its wait, so a catalog still loads", async () => {
		const server = startingServer(1_000);

		await locationReady(createKiloClient(server.connection), "/projects/app", {
			waitMs: 30,
			pollMs: 5,
		});

		expect(server.startingPolls).toBeGreaterThan(0);
	});
});

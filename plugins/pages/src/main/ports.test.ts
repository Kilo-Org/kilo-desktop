import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { allocateLoopbackPort, choosePort, isLoopbackPortFree, reclaimStaleCelld } from "./ports";

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
	);
});

async function occupy(port: number) {
	const server = createServer();
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
}

describe("loopback ports", () => {
	it("allocates a free port, and sees it taken while something listens on it", async () => {
		const port = await allocateLoopbackPort();

		expect(await isLoopbackPortFree(port)).toBe(true);
		await occupy(port);
		expect(await isLoopbackPortFree(port)).toBe(false);
	});

	it("leaves a listener that isn't celld alone", async () => {
		const port = await allocateLoopbackPort();
		await occupy(port);

		await reclaimStaleCelld(port);

		expect(await isLoopbackPortFree(port)).toBe(false);
	});
});

describe("choosePort", () => {
	const allocate = async () => 5000;
	const reclaim = async () => undefined;

	it("keeps the saved port while it is free", async () => {
		await expect(
			choosePort({ saved: 9899, isFree: async () => true, allocate, reclaim }),
		).resolves.toBe(9899);
	});

	it("reclaims the saved port from a stale server", async () => {
		const reclaimed: number[] = [];
		let free = false;

		const port = await choosePort({
			saved: 9899,
			isFree: async () => free,
			allocate,
			reclaim: async (taken) => {
				reclaimed.push(taken);
				free = true;
			},
		});

		expect({ port, reclaimed }).toEqual({ port: 9899, reclaimed: [9899] });
	});

	it("takes a new port when the saved one stays taken, or there is none", async () => {
		await expect(
			choosePort({ saved: 9899, isFree: async () => false, allocate, reclaim }),
		).resolves.toBe(5000);
		await expect(
			choosePort({ saved: null, isFree: async () => true, allocate, reclaim }),
		).resolves.toBe(5000);
	});
});

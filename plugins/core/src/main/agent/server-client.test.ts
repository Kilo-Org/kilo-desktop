import { describe, expect, it, vi } from "vitest";

import { callLocationRpc, createServerClient, locationPluginsReady } from "./server-client.js";

const connection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "opencode",
	password: "secret",
	version: "0.0.0-v2-239",
	globalDirectory: "/runtime",
};

const unavailable = { type: "rpc.unavailable", message: "No such RPC." };

function pluginsListing(...counts: number[]) {
	const list = vi.fn(async () => ({
		location: { directory: "/projects/app" },
		data: Array.from({ length: counts.shift() ?? 1 }, (_, index) => ({ id: `plugin-${index}` })),
	}));
	return { plugin: { list } } as unknown as Parameters<typeof callLocationRpc>[0] & {
		plugin: { list: typeof list };
	};
}

describe("createServerClient", () => {
	it("authenticates with the connection's per-launch credentials", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			Response.json({ version: "0.0.0-v2-239", pid: 1, urls: [] }),
		);
		const client = createServerClient(connection, { fetch });

		await expect(client.server.info()).resolves.toMatchObject({ version: "0.0.0-v2-239" });

		const request = new Request(fetch.mock.calls[0]![0], fetch.mock.calls[0]![1]);
		expect(new URL(request.url).pathname).toBe("/api/info");
		expect(request.headers.get("authorization")).toBe(
			`Basic ${Buffer.from("opencode:secret").toString("base64")}`,
		);
	});
});

describe("callLocationRpc", () => {
	it("returns the answer of a location whose plugins are ready", async () => {
		const client = pluginsListing();

		await expect(callLocationRpc(client, "/projects/app", async () => "ok")).resolves.toBe("ok");
		expect(client.plugin.list).not.toHaveBeenCalled();
	});

	it("waits for a starting location to list its plugins, then calls again", async () => {
		const client = pluginsListing(0, 0, 3);
		const call = vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValueOnce("ok");

		await expect(callLocationRpc(client, "/projects/app", call, { pollMs: 1 })).resolves.toBe("ok");
		expect(call).toHaveBeenCalledTimes(2);
		expect(client.plugin.list).toHaveBeenCalledTimes(3);
		expect(client.plugin.list).toHaveBeenCalledWith({ location: { directory: "/projects/app" } });
	});

	it("treats a second rpc.unavailable as the server lacking the plugin", async () => {
		const client = pluginsListing();
		const call = vi.fn().mockRejectedValue(unavailable);

		await expect(callLocationRpc(client, "/projects/app", call, { pollMs: 1 })).rejects.toEqual(
			unavailable,
		);
		expect(call).toHaveBeenCalledTimes(2);
	});

	it("rejects other failures without waiting", async () => {
		const client = pluginsListing();
		const failure = { type: "rpc.invalid_input", message: "Bad input." };

		await expect(
			callLocationRpc(client, "/projects/app", () => Promise.reject(failure)),
		).rejects.toEqual(failure);
		expect(client.plugin.list).not.toHaveBeenCalled();
	});

	it("gives up with the first answer when the caller stops being active", async () => {
		const client = pluginsListing(0);
		const call = vi.fn().mockRejectedValue(unavailable);

		await expect(
			callLocationRpc(client, "/projects/app", call, { pollMs: 1, active: () => false }),
		).rejects.toEqual(unavailable);
		expect(call).toHaveBeenCalledOnce();
	});
});

describe("locationPluginsReady", () => {
	it("waits until the location lists its plugins", async () => {
		const client = pluginsListing(0, 0, 2);

		await locationPluginsReady(client, "/projects/app", { pollMs: 1 });

		expect(client.plugin.list).toHaveBeenCalledTimes(3);
	});
});

import { afterEach, describe, expect, it } from "vitest";

import type { KernelLogger } from "@kilo-desktop/kernel";

import { bootMarketplace, fakeConnection } from "../test/boot-marketplace";
import { FakeKilo2Marketplace } from "../test/fake-kilo2-marketplace";

const demo = {
	id: "demo",
	name: "Demo",
	color: "#f00",
	folders: [{ path: "/workspaces/demo", isPrimary: true }],
};

function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}

/** The kernel reports kilo.marketplace's manifest contributions to absent plugins; the entry says nothing. */
const ownMessages = (messages: unknown[][]) =>
	messages.filter(([message]) => !/^\[[\w.-]+\] Contribution/.test(String(message)));

const kernels: { stop(): Promise<void> }[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
});

async function boot(options: Parameters<typeof bootMarketplace>[0]) {
	const booted = await bootMarketplace(options);
	kernels.push(booted.main);
	return booted;
}

describe("kilo.marketplace's main entry", () => {
	it("reaches Kilo's server through kilo.core and lists kilo.work-sessions' workspaces", async () => {
		const server = new FakeKilo2Marketplace();
		const { marketplace, connect } = await boot({ fetch: server.fetch, workspaces: [demo] });

		const snapshot = await marketplace.list({ workspaceId: "demo" });

		expect(connect).toHaveBeenCalled();
		expect(snapshot.targets).toEqual([
			{ id: "demo", name: "Demo", color: "#f00", directory: "/workspaces/demo" },
		]);
		expect(server.requests.length).toBeGreaterThan(0);
		expect(server.requests.every((request) => request.path.startsWith("/api/"))).toBe(true);
		expect(fakeConnection.username).toBe("opencode");
	});

	it("shows the MCP servers kilo.core/mcp-server contributions add to Kilo as built in", async () => {
		const server = new FakeKilo2Marketplace();
		const { marketplace } = await boot({
			fetch: server.fetch,
			desktopMcps: [{ id: "static-mcp", command: "node" }, { id: "no-command" }],
			dynamicMcps: {
				"dynamic-mcp": { type: "remote", url: "https://example.com/mcp" },
				"switched-off": undefined,
			},
		});

		const { included } = await marketplace.list({});

		expect(included.filter((entry) => entry.kind === "mcp").map((entry) => entry.id)).toEqual([
			"static-mcp",
			"dynamic-mcp",
		]);
		expect(included).toContainEqual(
			expect.objectContaining({ kind: "mcp", id: "static-mcp", installedIn: "Anaconda Desktop" }),
		);
	});

	it("activates without kilo.core, kilo.work-sessions, kilo.chat and kilo.shell, logging nothing", async () => {
		const { logger, warnings, errors } = recordingLogger();
		const server = new FakeKilo2Marketplace();
		const { marketplace } = await boot({ fetch: server.fetch, bare: true, logger });

		await expect(marketplace.list({})).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: "Kilo Server is unavailable.",
		});
		expect(ownMessages(warnings)).toEqual([]);
		expect(errors).toEqual([]);
	});
});

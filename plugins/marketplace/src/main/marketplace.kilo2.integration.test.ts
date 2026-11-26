import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	kilo2Executable,
	startKilo2,
	startStandInKiloApi,
	type Kilo2,
	type StandInKiloApi,
} from "@kilo-desktop/plugin-core/testing";

import { bootMarketplace } from "../test/boot-marketplace";

/** kilo2 reloads its config and starts a new MCP server a moment after an install. */
const eventually = <T>(assertion: () => T) => vi.waitFor(assertion, { timeout: 20_000 });

/**
 * kilo.marketplace against the bundled kilo2, with Kilo's Marketplace catalog
 * served by a stand-in Kilo API: listing, Kilo's preview, installs and
 * removals in the global and a workspace's location, and v2's agent list.
 */
describe.skipIf(!kilo2Executable)("kilo.marketplace on kilo2", () => {
	let api: StandInKiloApi;
	let kilo: Kilo2;
	let workspace: string;
	let booted: Awaited<ReturnType<typeof bootMarketplace>>;

	beforeAll(async () => {
		api = await startStandInKiloApi({
			marketplace: {
				mcps: [
					{
						id: "local-tools",
						name: "Local tools",
						description: "Tools on this computer.",
						category: "development",
						content: JSON.stringify({ command: "node", args: ["local-tools.js"] }),
					},
				],
				agents: [
					{
						id: "reviewer",
						name: "Reviewer",
						description: "Reviews changes.",
						category: "engineering",
						content: {
							mode: "subagent",
							description: "Reviews changes.",
							prompt: "Review the diff.",
						},
					},
				],
			},
		});
		kilo = await startKilo2({ apiUrl: api.url });
		workspace = await realpath(await mkdtemp(path.join(tmpdir(), "marketplace-workspace-")));
		booted = await bootMarketplace({
			fetch,
			connection: kilo.connection,
			workspaces: [{ id: "demo", name: "Demo", folders: [{ path: workspace, isPrimary: true }] }],
		});
	});

	afterAll(async () => {
		await booted?.main.stop();
		await kilo?.stop();
		await api?.stop();
		if (workspace) await rm(workspace, { recursive: true, force: true });
	});

	it("lists Kilo's catalog and its built-in agents", async () => {
		const snapshot = await booted.marketplace.list({ workspaceId: "demo" });

		expect(snapshot.errors).toEqual([]);
		expect(snapshot.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					registry: "kilo",
					kind: "mcp",
					id: "local-tools",
					name: "Local tools",
					options: [expect.objectContaining({ name: "Default" })],
				}),
				expect.objectContaining({ registry: "kilo", kind: "agent", id: "reviewer" }),
			]),
		);
		expect(snapshot.included).toContainEqual(
			expect.objectContaining({ kind: "agent", id: "code", category: "Built-in" }),
		);
		expect(snapshot.installed).toEqual([]);
	});

	it("previews, installs and removes a global MCP server", async () => {
		const input = {
			item: { registry: "kilo", kind: "mcp" as const, id: "local-tools" },
			scope: "global" as const,
			option: "Default",
		};
		const preview = await booted.marketplace.preview(input);
		expect(JSON.parse(preview.server)).toMatchObject({
			type: "local",
			command: ["node", "local-tools.js"],
		});
		expect(preview.config).toContain(path.join(kilo.home, ".config", "kilo2"));

		await booted.marketplace.install({ ...input, reviewed: preview.server });

		await eventually(async () => {
			const installed = (await booted.marketplace.list({})).installed;
			expect(installed).toEqual([
				expect.objectContaining({
					registry: "kilo",
					kind: "mcp",
					id: "local-tools",
					scope: "global",
					server: "local-tools",
					// The stand-in's launch command has no script to run.
					mcpStatus: expect.objectContaining({
						status: expect.stringMatching(/^(pending|failed)$/),
					}),
				}),
			]);
		});
		const written = await readFile(path.join(kilo.home, ".config", "kilo2", "kilo2.json"), "utf8");
		expect(written).toContain("local-tools.js");

		await booted.marketplace.remove({ item: input.item, scope: "global" });
		expect((await booted.marketplace.list({})).installed).toEqual([]);
	});

	it("installs and removes an agent in a workspace", async () => {
		const item = { registry: "kilo", kind: "agent" as const, id: "reviewer" };
		await booted.marketplace.install({ item, scope: "project", workspaceId: "demo" });

		const snapshot = await booted.marketplace.list({ workspaceId: "demo" });
		expect(snapshot.installed).toEqual([
			expect.objectContaining({
				kind: "agent",
				id: "reviewer",
				scope: "project",
				workspaceId: "demo",
			}),
		]);
		expect(snapshot.included.map((entry) => entry.id)).not.toContain("reviewer");

		await booted.marketplace.remove({ item, scope: "project", workspaceId: "demo" });
		expect((await booted.marketplace.list({ workspaceId: "demo" })).installed).toEqual([]);
	});

	it("passes Kilo's message on for an item it doesn't have", async () => {
		await expect(
			booted.marketplace.install({
				item: { registry: "kilo", kind: "skill", id: "nowhere" },
				scope: "global",
			}),
		).rejects.toMatchObject({ code: "BUSINESS", message: "No skill nowhere in kilo" });
	});
});

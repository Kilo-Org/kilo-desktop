import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createKiloV2MarketplaceApi } from "./kilo-v2-client";
import { KiloV2Marketplace } from "./kilo-v2-marketplace";

/**
 * The marketplace against a real kilo2, opt in: set `KILO2_BIN` to a kilo2
 * executable (core-v2 stages one under `plugins/core-v2/resources/kilo`).
 * It reads Kilo's live catalog, so it needs the network.
 */
const KILO2_BIN = process.env.KILO2_BIN;

describe.skipIf(!KILO2_BIN)("the marketplace on a real kilo2", () => {
	let home: string;
	let project: string;
	let kilo: ChildProcess;
	let marketplace: KiloV2Marketplace;

	beforeAll(async () => {
		home = realpathSync(mkdtempSync(path.join(tmpdir(), "k2market-")));
		project = path.join(home, "project");
		mkdirSync(project);
		kilo = spawn(KILO2_BIN!, ["serve", "--port", "0", "--stdio"], {
			cwd: home,
			env: {
				PATH: process.env.PATH,
				HOME: home,
				XDG_CONFIG_HOME: `${home}/c`,
				XDG_DATA_HOME: `${home}/d`,
				XDG_STATE_HOME: `${home}/s`,
				XDG_CACHE_HOME: `${home}/k`,
				OPENCODE_PASSWORD: "x",
				KILO2_CONFIG_DIR: `${home}/cfg`,
				KILO_DISABLE_MODELS_FETCH: "true",
			},
		});
		const url = await new Promise<string>((resolve) =>
			kilo.stdout!.once("data", (data: Buffer) =>
				resolve(JSON.parse(data.toString().split("\n")[0]!).url),
			),
		);
		marketplace = new KiloV2Marketplace(
			createKiloV2MarketplaceApi(
				{ baseUrl: url, username: "opencode", password: "x", globalDirectory: home },
				globalThis.fetch,
			),
		);
	});

	afterAll(() => {
		kilo?.stdin?.end();
		rmSync(home, { recursive: true, force: true });
	});

	it("lists the catalog with MCP configurations, installs into a project and removes again", async () => {
		const listed = await marketplace.list(home);
		const types = new Set(listed.items.map((item) => item.type));
		expect([...types].sort()).toEqual(["agent", "mcp", "skill"]);
		const mcp = listed.items.find((item) => item.type === "mcp");
		const rendered =
			mcp?.type === "mcp"
				? typeof mcp.content === "string"
					? mcp.content
					: mcp.content[0]!.content
				: "{}";
		expect(["local", "remote"]).toContain(JSON.parse(rendered).type);

		const skill = listed.items.find((item) => item.type === "skill")!;
		await marketplace.install(project, skill, "project", undefined, undefined);
		expect((await marketplace.list(project)).project).toContainEqual({
			type: "skill",
			id: skill.id,
		});

		await marketplace.remove(project, { type: "skill", id: skill.id }, "project");
		expect((await marketplace.list(project)).project).toEqual([]);
	});

	it("lists Kilo's agents and skills, and MCP statuses", async () => {
		const runtime = await marketplace.runtime(home);

		expect(runtime.agents.map((agent) => agent.id)).toContain("code");
		expect(runtime.skills.some((skill) => skill.location === "builtin")).toBe(true);
		await expect(marketplace.mcpStatuses(home)).resolves.toEqual({ servers: [], statuses: {} });
	});
});

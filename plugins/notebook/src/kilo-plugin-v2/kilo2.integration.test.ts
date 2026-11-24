/**
 * Opt-in smoke check against a real Kilo Code v2 server: the built
 * `resources/kilo-plugin-v2` directory loads as a local plugin, activates, and
 * its agent transform gates notebook execution. Skipped unless `KILO2_BIN`
 * names a kilo2 executable (e.g.
 * `plugins/core-v2/resources/kilo/darwin-arm64/bin/kilo2`); run
 * `pnpm build-kilo-plugin` first.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { OpenCode } from "@kilocode/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const KILO2_BIN = process.env.KILO2_BIN?.trim();
const PLUGIN_DIR = path.resolve(import.meta.dirname, "../../resources/kilo-plugin-v2");

function executable(file: string | undefined): file is string {
	if (!file) return false;
	try {
		accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

describe.skipIf(!executable(KILO2_BIN))("kilo2 loads the notebook plugin", () => {
	let root: string;
	let project: string;
	let server: ChildProcess | undefined;
	let client: ReturnType<typeof OpenCode.make>;

	beforeAll(async () => {
		if (!existsSync(path.join(PLUGIN_DIR, "index.js"))) {
			throw new Error(`${PLUGIN_DIR}/index.js is missing; run pnpm build-kilo-plugin first.`);
		}
		root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo2-notebook-")));
		project = path.join(root, "project");
		const config = path.join(root, "cfg");
		await Promise.all([mkdir(project), mkdir(config)]);
		await writeFile(path.join(config, "kilo2.jsonc"), JSON.stringify({ plugins: [PLUGIN_DIR] }));

		server = spawn(KILO2_BIN!, ["serve", "--port", "0", "--stdio"], {
			cwd: root,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				PATH: process.env.PATH,
				HOME: root,
				XDG_CONFIG_HOME: path.join(root, "xdg-config"),
				XDG_DATA_HOME: path.join(root, "xdg-data"),
				XDG_STATE_HOME: path.join(root, "xdg-state"),
				XDG_CACHE_HOME: path.join(root, "xdg-cache"),
				KILO2_CONFIG_DIR: config,
				OPENCODE_PASSWORD: "x",
				KILO_DISABLE_MODELS_FETCH: "true",
				// The plugin loads @runtimed/node at setup; resolve this checkout's copy.
				NTERACT_RUNTIMED_NODE_PATH: import.meta.resolve("@runtimed/node").replace("file://", ""),
			},
		});
		const firstLine = await new Promise<string>((resolve, reject) => {
			server!.once("exit", (code) => reject(new Error(`kilo2 exited with ${code}`)));
			createInterface({ input: server!.stdout! }).once("line", resolve);
		});
		const { url } = JSON.parse(firstLine) as { url: string };
		client = OpenCode.make({
			baseUrl: url,
			headers: { authorization: `Basic ${Buffer.from("opencode:x").toString("base64")}` },
		});
	});

	afterAll(async () => {
		server?.stdin?.end();
		server?.kill();
		if (root) await rm(root, { recursive: true, force: true });
	});

	it("activates anaconda-notebooks and gates notebook execution for the build agent", async () => {
		const location = { location: { directory: project } };

		await vi.waitFor(
			async () => {
				const plugins = (await client.plugin.list(location)).data as Array<Record<string, unknown>>;
				expect(plugins).toContainEqual(
					expect.objectContaining({ id: "anaconda-notebooks", state: { status: "active" } }),
				);
			},
			{ timeout: 20_000, interval: 200 },
		);

		const agents = (await client.agent.list(location)).data as Array<{
			id: string;
			permissions: Array<{ action: string; resource: string; effect: string }>;
		}>;
		const build = agents.find((agent) => agent.id === "build");
		expect(build?.permissions.slice(-2)).toEqual([
			{ action: "notebooks_trust", resource: "*", effect: "ask" },
			{ action: "notebooks_execute", resource: "*", effect: "ask" },
		]);
	});
});

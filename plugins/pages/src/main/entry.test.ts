import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { definePlugin, type HostBrowser, type PluginStorage } from "@kilo-desktop/kernel";
import { createMemoryStorage, createTestKernelPair } from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, McpServer, ServerEnv } from "@kilo-desktop/plugin-core/contracts";

import manifest from "../../plugin.json";
import { PAGES_DEFINITIONS, PagesServer } from "../contracts";
import { createPagesMainEntry, type PagesMainOptions } from "./entry";
import { verifyAgentToken } from "./identity-bridge";
import { allocateLoopbackPort } from "./ports";

const FAKE_CELLD = fileURLToPath(new URL("../test/fake-celld.mjs", import.meta.url));

const kernels: { stop(): Promise<void> }[] = [];
const folders: string[] = [];

afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	delete process.env["FAKE_CELLD_MODE"];
});

async function tempDir(prefix: string) {
	const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
	folders.push(dir);
	return dir;
}

async function fakeBuild() {
	const dir = await tempDir("pages-build-");
	await writeFile(path.join(dir, "index.js"), "export default {}");
	await mkdir(path.join(dir, "public"));
	await writeFile(path.join(dir, "wrangler.json"), JSON.stringify({ main: "index.js" }));
	await writeFile(path.join(dir, "build-receipt.json"), JSON.stringify({ build_id: "test" }));
	return dir;
}

interface Boot {
	readonly entry?: PagesMainOptions;
	readonly storage?: PluginStorage;
	readonly browser?: HostBrowser;
	readonly withBuild?: boolean;
}

async function boot(options: Boot = {}) {
	const storage = options.storage ?? createMemoryStorage(await tempDir("pages-storage-"));
	const buildDir = options.withBuild === false ? undefined : await fakeBuild();
	const coreStub = {
		manifest: coreManifest,
		definitions: CORE_DEFINITIONS,
		entry: definePlugin({ activate() {} }),
	};
	const { main, renderer } = await createTestKernelPair({
		main: [
			coreStub,
			{
				manifest,
				definitions: PAGES_DEFINITIONS,
				entry: createPagesMainEntry({
					resolveCelld: () => process.execPath,
					celldArgs: [FAKE_CELLD],
					resolveServerBuild: () => buildDir,
					user: { id: "local-user", name: "Ada" },
					readyTimeoutMs: 5_000,
					warmStart: false,
					...options.entry,
				}),
			},
		],
		renderer: [
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
			{ manifest, definitions: PAGES_DEFINITIONS, entry: definePlugin({ activate() {} }) },
		],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id
				? { storage, ...(options.browser ? { browser: options.browser } : {}) }
				: { storage: createMemoryStorage(`/memory/${pluginId}`) },
	});
	kernels.push(main);
	await main.flush();
	const pages = renderer.kernelSdk.domainObjects.get(PagesServer)!;
	const contribution = <T extends typeof McpServer | typeof ServerEnv>(point: T, id: string) =>
		main.kernelSdk.extensions.list(point).find((entry) => entry.key === `kilo.pages/${id}`)!;
	return {
		main,
		pages,
		storage,
		mcpEntry: () => contribution(McpServer, "pages-local").implementation?.read(),
		serverEnv: () => contribution(ServerEnv, "pages").implementation!.read(),
	};
}

const browserHost = (): HostBrowser & { initialized: number } => {
	const host = {
		partition: "persist:test-browser",
		initialized: 0,
		initialize() {
			host.initialized += 1;
		},
		attach: () => {
			throw new Error("unused");
		},
		serveLocalFiles: () => undefined,
	};
	return host;
};

describe("the Pages server", () => {
	it("is unavailable, with the reason, when the build or celld is missing", async () => {
		const { pages, mcpEntry, serverEnv } = await boot({ withBuild: false });

		expect(pages.getState()).toMatchObject({ status: "unavailable" });
		expect(pages.getState().message).toMatch(/Pages build/);
		await expect(pages.methods.ensure(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: expect.stringMatching(/Pages build/),
		});
		expect(mcpEntry()).toBeUndefined();
		expect(serverEnv()).toEqual({});
	});

	it("names celld as what is missing when it isn't installed", async () => {
		const { pages } = await boot({ entry: { resolveCelld: () => undefined } });

		await expect(pages.methods.ensure(undefined)).rejects.toMatchObject({
			message: expect.stringMatching(/celld isn't installed/),
		});
	});

	it("starts celld on the saved port, signed in through the identity bridge", async () => {
		const port = await allocateLoopbackPort();
		const { pages, storage } = await boot({ entry: { allocatePort: async () => port } });

		await expect(pages.methods.ensure(undefined)).resolves.toEqual({
			origin: `http://localhost:${port}`,
		});

		expect(pages.getState()).toEqual({
			status: "running",
			origin: `http://localhost:${port}`,
			message: null,
		});
		const devVars = await readFile(path.join(storage.dir, "server", ".dev.vars"), "utf8");
		const bridgeUrl = /PAGES_KILO_APP_URL=(.*)/.exec(devVars)![1]!;
		const signIn = await fetch(`${bridgeUrl}/pages-auth?audience=pages-desktop&state=s`, {
			redirect: "manual",
		});
		expect(signIn.headers.get("location")).toMatch(
			new RegExp(`^http://localhost:${port}/api/auth/kilo/callback\\?code=`),
		);
		const answer = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { cwd: string };
		expect(await realpath(answer.cwd)).toBe(await realpath(path.join(storage.dir, "server")));
	});

	it("readies the browser session and signs the pane in", async () => {
		const browser = browserHost();
		const { pages } = await boot({ browser });

		const view = await pages.methods.prepareView(undefined);

		const { origin } = pages.getState();
		expect(view).toEqual({
			partition: "persist:test-browser",
			url: `${origin}/api/auth/login?return_to=/pages`,
		});
		expect(browser.initialized).toBe(1);
	});

	it("can't show a view without the browser host", async () => {
		const { pages } = await boot();

		await expect(pages.methods.prepareView(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});

	it("reports why it failed to start", async () => {
		process.env["FAKE_CELLD_MODE"] = "crash";
		const { pages } = await boot();

		await expect(pages.methods.ensure(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: expect.stringMatching(/exited before it answered/),
		});
		expect(pages.getState().status).toBe("error");
	});

	it("starts again on demand after it gave up", async () => {
		process.env["FAKE_CELLD_MODE"] = "crash";
		const { pages } = await boot({ entry: { readyTimeoutMs: 2_000 } });
		await expect(pages.methods.ensure(undefined)).rejects.toThrow();
		await expect.poll(() => pages.getState().status, { timeout: 15_000 }).toBe("error");
		process.env["FAKE_CELLD_MODE"] = "serve";

		await expect
			.poll(async () => (await pages.methods.ensure(undefined).catch(() => null))?.origin, {
				timeout: 20_000,
				interval: 500,
			})
			.toMatch(/^http:\/\/localhost:/);
	}, 40_000);

	it("stops celld when the app quits", async () => {
		const port = await allocateLoopbackPort();
		const { main, pages } = await boot({ entry: { allocatePort: async () => port } });
		await pages.methods.ensure(undefined);

		await main.stop();

		await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
	});

	it("starts once the app is ready, for the agent", async () => {
		const { main, pages } = await boot({ entry: { warmStart: true } });
		expect(pages.getState().status).toBe("stopped");

		await main.windowShown();

		await expect.poll(() => pages.getState().status, { timeout: 10_000 }).toBe("running");
	});
});

describe("the agent's Pages MCP server", () => {
	it("is a remote entry whose URL and token come from the server's environment", async () => {
		const port = await allocateLoopbackPort();
		const { mcpEntry, serverEnv } = await boot({ entry: { allocatePort: async () => port } });

		await expect.poll(mcpEntry).toEqual({
			type: "remote",
			url: "{env:PAGES_MCP_URL}",
			oauth: false,
			headers: { Authorization: "Bearer {env:PAGES_MCP_TOKEN}" },
			enabled: true,
		});
		const env = serverEnv();
		expect(env["PAGES_MCP_URL"]).toBe(`http://127.0.0.1:${port}/mcp`);
		expect(env["PAGES_MCP_TOKEN"]).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
	});

	it("tells kilo.core once the port is chosen", async () => {
		let choose!: (port: number) => void;
		const chosen = new Promise<number>((resolve) => (choose = resolve));
		const { main } = await boot({ entry: { allocatePort: () => chosen } });
		const source = main.kernelSdk.extensions
			.list(ServerEnv)
			.find((entry) => entry.key === "kilo.pages/pages")!.implementation!;
		let changes = 0;
		source.subscribe!(() => void (changes += 1));
		expect(source.read()).toEqual({});

		choose(await allocateLoopbackPort());

		await expect.poll(() => changes).toBe(1);
		expect(Object.keys(source.read())).toEqual(["PAGES_MCP_URL", "PAGES_MCP_TOKEN"]);
	});

	it("gives the same environment on the next run, with a token the bridge accepts", async () => {
		const storage = createMemoryStorage(await tempDir("pages-storage-"));
		const port = await allocateLoopbackPort();
		const first = await boot({ storage, entry: { allocatePort: async () => port } });
		await expect.poll(() => first.serverEnv()["PAGES_MCP_URL"]).toBeDefined();
		const env = first.serverEnv();
		await first.main.stop();

		const second = await boot({ storage, entry: { allocatePort: async () => port + 1 } });

		expect(second.serverEnv()).toEqual(env);
		const signingKey = storage
			.kv({ namespace: "server", defaults: { signingKey: "" } })
			.get("signingKey");
		expect(
			verifyAgentToken(env["PAGES_MCP_TOKEN"]!, {
				audience: "pages-desktop",
				signingKey,
				nowSeconds: Math.floor(Date.now() / 1000),
			}),
		).toBe(true);
	});
});

async function realpath(target: string) {
	const { realpath: resolve } = await import("node:fs/promises");
	return resolve(target);
}

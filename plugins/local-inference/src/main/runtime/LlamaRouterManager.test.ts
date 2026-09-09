import { EventEmitter } from "node:events";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalModel } from "../../contracts/schemas.js";
import {
	LlamaRouterManager,
	type LlamaChildProcess,
	type LlamaRouterManagerOptions,
	type LlamaRouterStatus,
} from "./LlamaRouterManager.js";

const roots: string[] = [];

function deferred<T>(): {
	promise: Promise<T>;
	resolve(value: T): void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function model(id = "tiny-a1b2c3d4"): LocalModel {
	return {
		id,
		name: "Tiny",
		path: `/models/${id}.gguf`,
		available: true,
		addedAt: 1,
	};
}

function child(
	options: { exitOnKill?: boolean } = {},
): LlamaChildProcess & { killed: boolean; exit(): void; crash(): void } {
	const events = new EventEmitter();
	const result = {
		pid: 123,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null as number | null,
		killed: false,
		kill() {
			result.killed = true;
			if (options.exitOnKill !== false) result.exit();
			return true;
		},
		exit() {
			if (result.exitCode !== null) return;
			result.exitCode = 0;
			events.emit("exit", 0, null);
		},
		crash() {
			events.emit("exit", null, "SIGKILL");
		},
		on: events.on.bind(events),
		once: events.once.bind(events),
		off: events.off.bind(events),
	};
	return result;
}

async function setup(
	process = child(),
	extras: Partial<
		Pick<
			LlamaRouterManagerOptions,
			"healthTimeoutMs" | "modelLoadTimeoutMs" | "reclaimStaleRouters" | "stopTimeoutMs"
		>
	> = {},
) {
	const root = path.join(tmpdir(), `llama-router-${crypto.randomUUID()}`);
	roots.push(root);
	await mkdir(root, { recursive: true });
	const statuses: LlamaRouterStatus[] = [];
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const loaded = new Set<string>();
	const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		requests.push({ url: String(url), ...(init ? { init } : {}) });
		if (String(url).endsWith("/models/load") && typeof init?.body === "string") {
			loaded.add((JSON.parse(init.body) as { model: string }).model);
		}
		if (String(url).endsWith("/models")) {
			return Response.json({
				data: [...loaded].map((id) => ({ id, status: { value: "loaded" } })),
			});
		}
		return new Response("{}", { status: 200 });
	});
	const spawn = vi.fn(() => process);
	const resolveExecutable = vi.fn(async () => "/bin/llama-server");
	const manager = new LlamaRouterManager({
		storageDir: root,
		apiKey: "secret",
		resolveExecutable,
		allocatePort: async () => 43123,
		fetch,
		spawn,
		queryVersion: async () => "test",
		reclaimStaleRouters: async () => undefined,
		logger: { info() {}, warn() {}, error() {} },
		onStatusChange: (status) => statuses.push(status),
		healthRetryDelayMs: 1,
		...extras,
	});
	return { root, process, statuses, requests, fetch, spawn, resolveExecutable, manager };
}

beforeEach(() => {
	vi.spyOn(process, "kill").mockImplementation(() => {
		throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
	});
});

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	vi.restoreAllMocks();
});

describe("LlamaRouterManager", () => {
	it("stays idle and does not resolve the runtime without models", async () => {
		const ctx = await setup();

		await expect(ctx.manager.ensureRunning([])).resolves.toBeNull();

		expect(ctx.spawn).not.toHaveBeenCalled();
		expect(ctx.manager.status).toEqual({ status: "idle" });
	});

	it("coalesces startup and launches one router with one-model residency by default", async () => {
		const ctx = await setup();
		const models = [model(), model("other-deadbeef")];

		const [first, second] = await Promise.all([
			ctx.manager.ensureRunning(models),
			ctx.manager.ensureRunning(models),
		]);

		expect(first).toEqual(second);
		expect(first).toEqual({ baseUrl: "http://127.0.0.1:43123", port: 43123 });
		expect(ctx.spawn).toHaveBeenCalledOnce();
		expect(ctx.spawn).toHaveBeenCalledWith(
			"/bin/llama-server",
			expect.arrayContaining([
				"--models-preset",
				path.join(ctx.root, "runtime", "models.ini"),
				"--models-max",
				"1",
				"--no-models-autoload",
			]),
			expect.objectContaining({ detached: true }),
		);
		expect(await readFile(path.join(ctx.root, "runtime", "models.ini"), "utf8")).toContain(
			"[other-deadbeef]",
		);
		expect(ctx.statuses).toEqual([
			{ status: "preparing-runtime" },
			{ status: "starting" },
			{ status: "ready", loadedModelIds: [] },
		]);
	});

	it("restarts when model load mode or router flags change", async () => {
		const ctx = await setup();
		const models = [model(), model("other-deadbeef")];
		await ctx.manager.ensureRunning(models, { modelLoadMode: "one" });
		ctx.spawn.mockImplementation(() => child());

		await ctx.manager.ensureRunning(models, {
			modelLoadMode: "all",
			llamaFlags: { timeout: "120" },
		});

		expect(ctx.spawn).toHaveBeenCalledTimes(2);
		expect(ctx.spawn).toHaveBeenNthCalledWith(
			2,
			"/bin/llama-server",
			expect.arrayContaining(["--models-max", "2", "--timeout", "120"]),
			expect.objectContaining({ detached: true }),
		);
		await ctx.manager.ensureRunning(models, {
			modelLoadMode: "all",
			llamaFlags: { timeout: "120" },
		});
		expect(ctx.spawn).toHaveBeenCalledTimes(2);
	});

	it("coalesces model preparation and waits for llama.cpp to accept the load", async () => {
		const ctx = await setup();
		const selected = model();

		await Promise.all([
			ctx.manager.prepareModel(selected.id, [selected]),
			ctx.manager.prepareModel(selected.id, [selected]),
		]);

		const loads = ctx.requests.filter(({ url }) => url.endsWith("/models/load"));
		expect(loads).toHaveLength(1);
		expect(loads[0]?.init).toMatchObject({
			method: "POST",
			headers: {
				Authorization: "Bearer secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ model: selected.id }),
		});
		expect(ctx.manager.status).toEqual({
			status: "ready",
			loadedModelId: selected.id,
			loadedModelIds: [selected.id],
		});
	});

	it("reloads a model after the router evicts it at the configured limit", async () => {
		const ctx = await setup();
		const first = model("tiny-aaaa");
		const second = model("tiny-bbbb");
		const models = [first, second];
		const loaded = new Set<string>();
		ctx.fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
			if (String(url).endsWith("/models/load") && typeof init?.body === "string") {
				loaded.clear();
				loaded.add((JSON.parse(init.body) as { model: string }).model);
			}
			if (String(url).endsWith("/models")) {
				return Response.json({
					data: [...loaded].map((id) => ({ id, status: { value: "loaded" } })),
				});
			}
			return new Response("{}", { status: 200 });
		});

		await ctx.manager.ensureRunning(models, { modelLoadMode: "one" });
		await ctx.manager.prepareModel(first.id, models);
		await ctx.manager.prepareModel(second.id, models);
		await ctx.manager.prepareModel(first.id, models);

		const loads = ctx.fetch.mock.calls.filter(([url]) => String(url).endsWith("/models/load"));
		expect(loads.map(([, init]) => init?.body)).toEqual([
			JSON.stringify({ model: first.id }),
			JSON.stringify({ model: second.id }),
			JSON.stringify({ model: first.id }),
		]);
		expect(ctx.manager.status).toEqual({
			status: "ready",
			loadedModelId: first.id,
			loadedModelIds: [first.id],
		});
	});

	it("terminates the process when disposed", async () => {
		const ctx = await setup();
		await ctx.manager.ensureRunning([model()]);

		ctx.manager.dispose();

		expect(ctx.process.killed).toBe(true);
		expect(ctx.manager.status).toEqual({ status: "idle" });
	});

	it("does not finish stopping until the router process has exited", async () => {
		const process = child({ exitOnKill: false });
		const ctx = await setup(process);
		await ctx.manager.ensureRunning([model()]);
		ctx.spawn.mockImplementation(() => child());

		const stopped = ctx.manager.ensureRunning([]);
		await expect(
			Promise.race([stopped.then(() => "stopped"), delay(40).then(() => "waiting")]),
		).resolves.toBe("waiting");
		expect(process.killed).toBe(true);
		expect(ctx.manager.status).toEqual({ status: "stopping" });

		process.exit();
		await stopped;

		expect(ctx.manager.status).toEqual({ status: "idle" });
		await expect(ctx.manager.ensureRunning([model()])).resolves.toMatchObject({
			port: 43123,
		});
		expect(ctx.spawn).toHaveBeenCalledTimes(2);
	});

	it("finishes stopping after the force-kill timeout when exit is never emitted", async () => {
		const process = child({ exitOnKill: false });
		const ctx = await setup(process, { stopTimeoutMs: 10 });
		await ctx.manager.ensureRunning([model()]);

		await expect(ctx.manager.ensureRunning([])).resolves.toBeNull();

		expect(process.killed).toBe(true);
		expect(ctx.manager.status).toEqual({ status: "idle" });
	});

	it("isolates model loads from a router generation that was restarted", async () => {
		const firstChild = child();
		const secondChild = child();
		const ctx = await setup(firstChild, { modelLoadTimeoutMs: 30 });
		const firstLoadResponse = deferred<Response>();
		const loaded = new Set<string>();
		let loadRequestCount = 0;
		ctx.spawn.mockImplementation(() => secondChild);
		ctx.spawn.mockReturnValueOnce(firstChild);
		ctx.fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
			if (String(url).endsWith("/models/load") && typeof init?.body === "string") {
				loadRequestCount += 1;
				const modelId = (JSON.parse(init.body) as { model: string }).model;
				if (loadRequestCount === 1) return firstLoadResponse.promise;
				loaded.clear();
				loaded.add(modelId);
			}
			if (String(url).endsWith("/models")) {
				return Response.json({
					data: [...loaded].map((id) => ({ id, status: "loaded" })),
				});
			}
			return new Response("{}", { status: 200 });
		});
		const first = model("tiny-aaaa");
		const second = model("tiny-bbbb");
		const models = [first, second];

		const staleLoad = ctx.manager.prepareModel(first.id, models);
		await vi.waitFor(() => expect(loadRequestCount).toBe(1));
		await ctx.manager.restart(models);
		const currentLoad = ctx.manager.prepareModel(second.id, models);
		const currentResult = await Promise.race([
			currentLoad.then(() => "ready"),
			delay(20).then(() => "blocked"),
		]);
		firstLoadResponse.resolve(new Response("{}", { status: 200 }));

		await expect(staleLoad).rejects.toThrow(/cancelled/);
		await currentLoad;
		expect(currentResult).toBe("ready");
		expect(ctx.manager.status).toEqual({
			status: "ready",
			loadedModelId: second.id,
			loadedModelIds: [second.id],
		});
	});

	it("reconnects even if the previous startup is still unwinding", async () => {
		const firstChild = child({ exitOnKill: false });
		const secondChild = child();
		const ctx = await setup(firstChild);
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/health") && ctx.spawn.mock.calls.length === 1) {
				await delay(80);
			}
			return new Response("{}", { status: 200 });
		});
		ctx.spawn.mockImplementation(() => secondChild);
		ctx.spawn.mockReturnValueOnce(firstChild);

		const first = ctx.manager.ensureRunning([model()]);
		await vi.waitFor(() => expect(ctx.spawn).toHaveBeenCalledOnce());

		const stopped = ctx.manager.ensureRunning([]);
		const second = ctx.manager.ensureRunning([model()]);
		firstChild.exit();

		await expect(first).rejects.toThrow(/cancelled/);
		await stopped;
		await expect(second).resolves.toMatchObject({ port: 43123 });
		expect(secondChild.killed).toBe(false);
	});

	it("treats a signal-killed router as a crash during startup", async () => {
		const llama = child();
		const ctx = await setup(llama);
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/health")) throw new Error("ECONNREFUSED");
			return new Response("{}", { status: 200 });
		});

		const start = ctx.manager.ensureRunning([model()]);
		await vi.waitFor(() => expect(ctx.spawn).toHaveBeenCalledOnce());
		llama.crash();

		await expect(start).rejects.toThrow("llama-server exited before becoming healthy.");
		expect(ctx.manager.status).toEqual({
			status: "error",
			message: "Local inference could not start. Check the model files and try again.",
		});
	});

	it("keeps a router that is still alive after a detach exit report", async () => {
		vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			if (pid === 123 && signal === 0) return true;
			throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
		});
		const llama = child();
		const ctx = await setup(llama);
		let crashed = false;
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/health") && !crashed) {
				llama.crash();
				crashed = true;
				throw new Error("not listening yet");
			}
			return new Response("{}", { status: 200 });
		});

		await expect(ctx.manager.ensureRunning([model()])).resolves.toMatchObject({
			port: 43123,
		});
		expect(ctx.manager.status).toEqual({ status: "ready", loadedModelIds: [] });
		expect(llama.killed).toBe(false);
	});

	it("keeps probing health when exit is reported but the pid is still alive", async () => {
		vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			if (pid === 123 && signal === 0) return true;
			throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
		});
		const llama = child();
		const ctx = await setup(llama);
		let probes = 0;
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/health")) {
				probes += 1;
				if (probes === 1) {
					llama.exit();
					throw new Error("not listening yet");
				}
				return new Response("{}", { status: 200 });
			}
			return new Response("{}", { status: 200 });
		});

		await expect(ctx.manager.ensureRunning([model()])).resolves.toMatchObject({
			port: 43123,
		});
		expect(llama.killed).toBe(false);
	});

	it("times out when llama-server never becomes healthy", async () => {
		const ctx = await setup(child(), { healthTimeoutMs: 30 });
		ctx.fetch.mockImplementation(async () => new Response("no", { status: 503 }));

		await expect(ctx.manager.ensureRunning([model()])).rejects.toThrow(
			"llama-server did not become healthy in time.",
		);
	});

	it("stops waiting for a model when the load is cancelled mid-poll", async () => {
		const ctx = await setup();
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/models/load")) return new Response("{}", { status: 200 });
			if (String(url).endsWith("/models")) {
				throw new Error("Local inference model load was cancelled.");
			}
			return new Response("{}", { status: 200 });
		});

		await expect(ctx.manager.prepareModel(model().id, [model()])).rejects.toThrow(
			"Local inference model load was cancelled.",
		);
	});

	it("retries model list probes after a transient router reset", async () => {
		const selected = model();
		const ctx = await setup();
		let probes = 0;
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/models/load")) return new Response("{}", { status: 200 });
			if (String(url).endsWith("/models")) {
				probes += 1;
				if (probes === 1) throw new Error("ECONNRESET");
				return Response.json({ data: [{ id: selected.id, status: "loaded" }] });
			}
			return new Response("{}", { status: 200 });
		});

		await ctx.manager.prepareModel(selected.id, [selected]);
		expect(ctx.manager.status).toEqual({
			status: "ready",
			loadedModelId: selected.id,
			loadedModelIds: [selected.id],
		});
	});

	it("times out when a model never finishes loading", async () => {
		const ctx = await setup(child(), { modelLoadTimeoutMs: 30 });
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/models")) {
				return Response.json({ data: [] });
			}
			return new Response("{}", { status: 200 });
		});

		await expect(ctx.manager.prepareModel(model().id, [model()])).rejects.toThrow(
			'did not finish loading model "tiny-a1b2c3d4"',
		);
	});

	it("treats llama.cpp loaded status strings as ready", async () => {
		const selected = model();
		const ctx = await setup();
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/models/load")) return new Response("{}", { status: 200 });
			if (String(url).endsWith("/models")) {
				return Response.json({ data: [{ id: selected.id, status: "loaded" }] });
			}
			return new Response("{}", { status: 200 });
		});

		await ctx.manager.prepareModel(selected.id, [selected]);
		expect(ctx.manager.status).toEqual({
			status: "ready",
			loadedModelId: selected.id,
			loadedModelIds: [selected.id],
		});
	});

	it("surfaces HTTP errors from llama.cpp model load", async () => {
		const ctx = await setup();
		ctx.fetch.mockImplementation(async (url: string | URL | Request) => {
			if (String(url).endsWith("/models/load")) return new Response("no", { status: 500 });
			return new Response("{}", { status: 200 });
		});

		await expect(ctx.manager.prepareModel(model().id, [model()])).rejects.toThrow(/HTTP 500/);
		expect(ctx.manager.status).toEqual({
			status: "error",
			message: "Local inference could not start. Check the model files and try again.",
		});
	});

	it("does not reinstall llama.cpp when restarting a resolved router", async () => {
		const ctx = await setup();
		await ctx.manager.ensureRunning([model()]);
		ctx.spawn.mockImplementation(() => child());
		ctx.statuses.length = 0;

		await ctx.manager.ensureRunning([]);
		await ctx.manager.ensureRunning([model()]);

		expect(ctx.resolveExecutable).toHaveBeenCalledOnce();
		expect(ctx.statuses).toEqual([
			{ status: "stopping" },
			{ status: "idle" },
			{ status: "starting" },
			{ status: "ready", loadedModelIds: [] },
		]);
	});
});

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

import { afterEach, describe, expect, it, vi } from "vitest";

import { KernelApp, KernelService, KernelServices, type ServiceImplementation } from "../builtins";
import { KernelError } from "../errors";
import type { PluginSdk } from "../sdk";
import { testPlugin } from "../test-fixtures";
import { createMainKernel } from "./main-kernel";

const host = () => ({
	platform: "mac" as const,
	version: "1.0.0",
	confirm: async () => true,
	quit: () => {},
	relaunch: () => {},
});

function servicePlugin(
	id: string,
	service: Record<string, unknown>,
	implementation: ServiceImplementation,
	extra: { manifest?: Record<string, unknown>; activate?: (sdk: PluginSdk) => void } = {},
) {
	return testPlugin(id, {
		manifest: {
			contributes: { extensions: { "kernel/service": [{ id: "svc", ...service }] } },
			...extra.manifest,
		},
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(KernelService, "svc", implementation);
				extra.activate?.(sdk);
			},
		},
	});
}

function statusOf(kernel: ReturnType<typeof createMainKernel>, key: string) {
	return kernel.kernelSdk.domainObjects.get(KernelServices)!.getState().services[key];
}

afterEach(() => {
	vi.useRealTimers();
});

describe("service supervision — starting", () => {
	it("starts window-shown services after the window shows, then reports the app ready", async () => {
		let finishStart = () => {};
		let reportLater: (message: string) => void = () => {};
		const start = vi.fn(async ({ progress }: { progress: (m: string) => void }) => {
			progress("Warming up…");
			reportLater = progress;
			await new Promise<void>((resolve) => (finishStart = resolve));
		});
		const kernel = createMainKernel({
			host: host(),
			registrations: [servicePlugin("acme.svc", { title: "Server", kind: "daemon" }, { start })],
		});

		await kernel.start();
		expect(start).not.toHaveBeenCalled();
		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({ status: "idle", title: "Server" });

		const shown = kernel.windowShown();
		await vi.waitFor(() =>
			expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({
				status: "starting",
				progress: "Warming up…",
			}),
		);
		finishStart();
		await shown;

		expect(start).toHaveBeenCalledOnce();
		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({ status: "ready" });
		expect(statusOf(kernel, "acme.svc/svc")).not.toHaveProperty("progress");
		expect(kernel.kernelSdk.domainObjects.get(KernelApp)!.getState().phase).toBe("ready");

		// A ready service may still report progress (e.g. indexing).
		reportLater("Indexing…");
		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({
			status: "ready",
			progress: "Indexing…",
		});
	});

	it("starts activation services as soon as their plugin is active", async () => {
		const start = vi.fn();
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{ title: "Early", kind: "daemon", startOn: "activation" },
					{ start },
				),
			],
		});

		await kernel.start();

		expect(start).toHaveBeenCalledOnce();
	});

	it("holds activation services until the host's environment is ready", async () => {
		const start = vi.fn();
		let environmentReady = () => {};
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{ title: "Early", kind: "daemon", startOn: "activation" },
					{ start },
				),
			],
		});

		await kernel.start({
			environmentReady: new Promise<void>((resolve) => (environmentReady = resolve)),
		});
		const shown = kernel.windowShown();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(start).not.toHaveBeenCalled();
		environmentReady();
		await shown;

		expect(start).toHaveBeenCalledOnce();
	});

	it("holds first-use services until booted, and has ensureStarted wait for them", async () => {
		const start = vi.fn();
		let environmentReady = () => {};
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{ title: "Lazy", kind: "daemon", startOn: "first-use" },
					{ start },
				),
			],
		});
		await kernel.start({
			environmentReady: new Promise<void>((resolve) => (environmentReady = resolve)),
		});

		const ensured = kernel.services.ensureStarted("acme.svc/svc");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(start).not.toHaveBeenCalled();
		environmentReady();
		await ensured;

		expect(start).toHaveBeenCalledOnce();
		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({ status: "ready" });
	});

	it("has ensureStarted wait for a window-shown service until the window shows", async () => {
		const start = vi.fn();
		const kernel = createMainKernel({
			host: host(),
			registrations: [servicePlugin("acme.svc", { title: "Router", kind: "daemon" }, { start })],
		});
		await kernel.start();

		const ensured = kernel.services.ensureStarted("acme.svc/svc");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(start).not.toHaveBeenCalled();
		await kernel.windowShown();
		await ensured;

		expect(start).toHaveBeenCalledOnce();
	});

	it("starts first-use services only when asked, and marks tasks completed", async () => {
		const start = vi.fn();
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin("acme.svc", { title: "Lazy", kind: "task", startOn: "first-use" }, { start }),
			],
		});
		await kernel.start();
		await kernel.windowShown();
		expect(start).not.toHaveBeenCalled();

		await kernel.kernelSdk.domainObjects
			.get(KernelServices)!
			.methods.ensureStarted({ key: "acme.svc/svc" });

		expect(start).toHaveBeenCalledOnce();
		expect(statusOf(kernel, "acme.svc/svc")?.status).toBe("completed");
	});

	it("starts and stops a service as its when condition changes", async () => {
		const start = vi.fn();
		const stop = vi.fn();
		let sdk: PluginSdk | undefined;
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{ title: "Gated", kind: "daemon", when: { all: ["acme.svc/enabled"] } },
					{ start, stop },
					{
						manifest: { contextKeys: [{ id: "enabled" }] },
						activate: (pluginSdk) => void (sdk = pluginSdk),
					},
				),
			],
		});
		await kernel.start();
		await kernel.windowShown();
		expect(start).not.toHaveBeenCalled();

		sdk!.context.set("enabled", true);
		await kernel.services.settled();
		expect(start).toHaveBeenCalledOnce();

		sdk!.context.set("enabled", false);
		await kernel.services.settled();
		expect(stop).toHaveBeenCalledOnce();
		expect(statusOf(kernel, "acme.svc/svc")?.status).toBe("stopped");
	});

	it("starts a service again when its when holds once more while it is still stopping", async () => {
		let finishStop: () => void = () => {};
		const start = vi.fn();
		const stop = vi.fn(() => new Promise<void>((resolve) => (finishStop = resolve)));
		let sdk: PluginSdk | undefined;
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{ title: "Gated", kind: "daemon", when: { all: ["acme.svc/enabled"] } },
					{ start, stop },
					{
						manifest: { contextKeys: [{ id: "enabled" }] },
						activate: (pluginSdk) => {
							sdk = pluginSdk;
							pluginSdk.context.set("enabled", true);
						},
					},
				),
			],
		});
		await kernel.start();
		await kernel.windowShown();

		sdk!.context.set("enabled", false);
		await vi.waitFor(() => expect(stop).toHaveBeenCalled());
		sdk!.context.set("enabled", true);
		finishStop();
		await kernel.services.settled();

		expect(start).toHaveBeenCalledTimes(2);
		expect(statusOf(kernel, "acme.svc/svc")?.status).toBe("ready");
	});
});

describe("service supervision — plugins behind a manifest `when`", () => {
	/** A plugin owning `acme.flags/flag:*`, and a gated plugin running one activation daemon. */
	function gatedService(implementation: ServiceImplementation, onDeactivate: () => void) {
		let flags: PluginSdk | undefined;
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				testPlugin("acme.flags", {
					manifest: { contextKeys: [{ id: "flag:*", scope: "global" }] },
					entry: {
						activate: (sdk) => {
							flags = sdk;
							sdk.context.set("flag:beta", true);
						},
					},
				}),
				servicePlugin(
					"acme.beta",
					{ title: "Beta", kind: "daemon", startOn: "activation" },
					implementation,
					{
						manifest: { when: { all: ["acme.flags/flag:beta"] } },
						activate: (sdk) => sdk.onDispose(onDeactivate),
					},
				),
			],
		});
		return { kernel, setFlag: (on: boolean) => flags!.context.set("flag:beta", on) };
	}

	it("stops the plugin's services before deactivating it when its `when` turns false", async () => {
		const order: string[] = [];
		const { kernel, setFlag } = gatedService(
			{ start: () => {}, stop: () => void order.push("stop service") },
			() => void order.push("deactivate plugin"),
		);
		await kernel.start();
		await kernel.services.settled();

		setFlag(false);
		await kernel.flush();

		expect(order).toEqual(["stop service", "deactivate plugin"]);
		expect(statusOf(kernel, "acme.beta/svc")?.status).toBe("stopped");
	});

	it("starts the service again when the `when` turns back on while it is still stopping", async () => {
		let finishStop: () => void = () => {};
		const start = vi.fn();
		const stop = vi.fn(() => new Promise<void>((resolve) => (finishStop = resolve)));
		const { kernel, setFlag } = gatedService({ start, stop }, () => {});
		await kernel.start();
		await kernel.services.settled();

		setFlag(false);
		await vi.waitFor(() => expect(stop).toHaveBeenCalled());
		setFlag(true);
		finishStop();
		await kernel.flush();
		await kernel.services.settled();

		expect(start).toHaveBeenCalledTimes(2);
		expect(statusOf(kernel, "acme.beta/svc")?.status).toBe("ready");
	});
});

describe("service supervision — failures", () => {
	it("restarts a failing service with backoff, then gives up", async () => {
		vi.useFakeTimers();
		const start = vi.fn(async () => {
			throw new Error("cannot bind port");
		});
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{
						title: "Flaky",
						kind: "daemon",
						restart: {
							policy: "on-failure",
							maxRetries: 2,
							initialDelayMs: 100,
							maxDelayMs: 1_000,
						},
					},
					{ start },
				),
			],
		});
		await kernel.start();
		await kernel.windowShown();
		expect(statusOf(kernel, "acme.svc/svc")?.status).toBe("restarting");

		await vi.advanceTimersByTimeAsync(100);
		expect(start).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(200);
		expect(start).toHaveBeenCalledTimes(3);

		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({ status: "failed", restarts: 2 });
		expect(statusOf(kernel, "acme.svc/svc")?.error).toContain("cannot bind port");
	});

	it("starts a service that gave up again when asked to restart", async () => {
		vi.useFakeTimers();
		let healthy = false;
		const start = vi.fn(async () => {
			if (!healthy) throw new Error("cannot bind port");
		});
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{
						title: "Flaky",
						kind: "daemon",
						restart: { policy: "on-failure", maxRetries: 1, initialDelayMs: 100, maxDelayMs: 100 },
					},
					{ start },
				),
			],
		});
		await kernel.start();
		await kernel.windowShown();
		await vi.advanceTimersByTimeAsync(100);
		expect(statusOf(kernel, "acme.svc/svc")?.status).toBe("failed");
		const statuses: string[] = [];
		kernel.kernelSdk.domainObjects
			.get(KernelServices)!
			.on("status-changed", ({ status }) => void statuses.push(status));

		healthy = true;
		await kernel.kernelSdk.domainObjects
			.get(KernelServices)!
			.methods.restart({ key: "acme.svc/svc" });

		expect(statuses).toEqual(["idle", "starting", "ready"]);
		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({ status: "ready", restarts: 0 });
		expect(statusOf(kernel, "acme.svc/svc")).not.toHaveProperty("error");
	});

	it("keeps a failure's local detail on the record, apart from its message, until the next start", async () => {
		let healthy = false;
		const start = vi.fn(async () => {
			if (!healthy) {
				throw new KernelError("BUSINESS", "Server exited before becoming ready (code 1).", {
					detail: "Configuration is invalid\n↳ Unrecognized key: reasoning_display",
				});
			}
		});
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{ title: "Server", kind: "daemon", restart: { policy: "never" } },
					{ start },
				),
			],
		});
		await kernel.start();
		await kernel.windowShown();

		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({
			status: "failed",
			error: "Server exited before becoming ready (code 1).",
			detail: "Configuration is invalid\n↳ Unrecognized key: reasoning_display",
		});

		healthy = true;
		await kernel.kernelSdk.domainObjects
			.get(KernelServices)!
			.methods.restart({ key: "acme.svc/svc" });
		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({ status: "ready" });
		expect(statusOf(kernel, "acme.svc/svc")).not.toHaveProperty("detail");
	});

	it("restarts a daemon that reports a crash after becoming ready", async () => {
		vi.useFakeTimers();
		let fail: ((error: unknown) => void) | undefined;
		const start = vi.fn(async (context: { fail: (error: unknown) => void }) => {
			fail = context.fail;
		});
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{ title: "Daemon", kind: "daemon", restart: { initialDelayMs: 50 } },
					{ start },
				),
			],
		});
		await kernel.start();
		await kernel.windowShown();

		fail!(new Error("exited with code 1"));
		expect(statusOf(kernel, "acme.svc/svc")?.status).toBe("restarting");
		await vi.advanceTimersByTimeAsync(50);

		expect(start).toHaveBeenCalledTimes(2);
		expect(statusOf(kernel, "acme.svc/svc")).toMatchObject({ status: "ready", restarts: 1 });
	});
});

describe("service supervision — stopping", () => {
	it("stops services in reverse plugin order, aborting their signal, before plugins deactivate", async () => {
		const order: string[] = [];
		const signals: AbortSignal[] = [];
		const service = (name: string): ServiceImplementation => ({
			start: ({ signal }) => void signals.push(signal),
			stop: () => void order.push(`stop ${name}`),
		});
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin("acme.first", { title: "First", kind: "daemon" }, service("first")),
				servicePlugin("acme.second", { title: "Second", kind: "daemon" }, service("second"), {
					activate: (sdk) => sdk.onDispose(() => void order.push("deactivate second")),
				}),
			],
		});
		await kernel.start();
		await kernel.windowShown();

		await kernel.stop();

		expect(order).toEqual(["stop second", "stop first", "deactivate second"]);
		expect(signals.every((signal) => signal.aborted)).toBe(true);
	});

	it("does not wait longer than a service's stop timeout", async () => {
		vi.useFakeTimers();
		const kernel = createMainKernel({
			host: host(),
			registrations: [
				servicePlugin(
					"acme.svc",
					{ title: "Stubborn", kind: "daemon", stopTimeoutMs: 100 },
					{ start: () => {}, stop: () => new Promise(() => {}) },
				),
			],
		});
		await kernel.start();
		await kernel.windowShown();

		const stopping = kernel.stop();
		await vi.advanceTimersByTimeAsync(100);

		await expect(stopping).resolves.toBeUndefined();
		expect(statusOf(kernel, "acme.svc/svc")?.status).toBe("stopped");
	});
});

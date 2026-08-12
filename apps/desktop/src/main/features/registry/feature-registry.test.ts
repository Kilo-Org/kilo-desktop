import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineMethod, FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import { BusinessError } from "../../platform/BusinessError.js";
import {
	bootFeatures,
	createFeatureHandlers,
	createFeatureMessageHandlers,
	createFeaturePortHandlers,
	featureRouter,
} from "./feature-registry.js";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
	vi.restoreAllMocks();
});

describe("feature registration", () => {
	it("wires feature options, skips duplicate boots, and disposes successful registrations", async () => {
		const storageRoot = mkdtempSync(path.join(tmpdir(), "feature-registry-"));
		directories.push(storageRoot);
		const relay = vi.fn();
		const disposed = vi.fn();
		const resolveAsset = vi.fn((subpath: string) => `/plugin/${subpath}`);
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const createLogger = vi.fn(() => logger);
		const fetch = vi.fn(async () => Response.json({ ok: true })) as typeof globalThis.fetch;
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const featureId = "registry-options-test";
		const registration = {
			id: featureId,
			resolveAsset,
			mainRegister(mainSdk: MainSdk) {
				expect(mainSdk.logger).toBe(logger);
				expect(mainSdk.net.fetch).toBe(fetch);
				expect(mainSdk.storageDir).toBe(path.join(storageRoot, "plugins", featureId));
				expect(mainSdk.resolvePluginAsset("migrations")).toBe("/plugin/migrations");
				mainSdk.events.emit("ready", { id: "1" });
				mainSdk.onDispose(disposed);
			},
		};

		const options = { emitEvent: relay, storageRoot, createLogger, fetch };
		const dispose = await bootFeatures([registration], options);
		const duplicateDispose = await bootFeatures([registration], options);

		expect(relay).toHaveBeenCalledWith({
			featureId,
			name: "ready",
			payload: { id: "1" },
		});
		expect(resolveAsset).toHaveBeenCalledWith("migrations");
		expect(createLogger).toHaveBeenCalledOnce();
		expect(createLogger).toHaveBeenCalledWith(featureId);
		expect(warning).toHaveBeenCalledWith(expect.stringContaining("is already booted"));
		duplicateDispose();
		expect(disposed).not.toHaveBeenCalled();

		dispose();
		expect(disposed).toHaveBeenCalledOnce();
	});

	it("rolls back failed registrations and allows a later retry", async () => {
		const featureId = "registry-rollback-test";
		const disposed = vi.fn();
		const error = new Error("registration failed");
		const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const failedDispose = await bootFeatures([
			{
				id: featureId,
				mainRegister(mainSdk) {
					mainSdk.onDispose(disposed);
					throw error;
				},
			},
		]);

		expect(logging).toHaveBeenCalledWith(
			expect.stringContaining(`mainRegister failed for "${featureId}"`),
			error,
		);
		expect(disposed).toHaveBeenCalledOnce();
		failedDispose();

		const registered = vi.fn();
		const retryDispose = await bootFeatures([{ id: featureId, mainRegister: registered }]);
		expect(registered).toHaveBeenCalledOnce();
		retryDispose();
	});

	it("invokes onBeforeFeatureBoot callback for each feature before mainRegister", async () => {
		const featureId = "registry-progress-test";
		const progress = vi.fn();
		const registerOrder: string[] = [];

		const dispose = await bootFeatures(
			[
				{
					id: featureId,
					mainRegister() {
						registerOrder.push("register");
					},
				},
			],
			{
				onBeforeFeatureBoot: (id) => {
					progress(id);
					registerOrder.push("progress");
				},
			},
		);

		expect(progress).toHaveBeenCalledWith(featureId);
		expect(registerOrder).toEqual(["progress", "register"]);
		dispose();
	});

	it("routes mainSdk.boot.reportProgress to onFeatureProgress during boot and no-ops after", async () => {
		const featureId = "registry-boot-progress-test";
		const onFeatureProgress = vi.fn();
		let capturedSdk: MainSdk | undefined;

		const dispose = await bootFeatures(
			[
				{
					id: featureId,
					mainRegister(mainSdk) {
						capturedSdk = mainSdk;
						mainSdk.boot.reportProgress("Preparing…");
						mainSdk.boot.reportProgress("Ready.");
					},
				},
			],
			{ onFeatureProgress },
		);

		expect(onFeatureProgress).toHaveBeenNthCalledWith(1, featureId, "Preparing…");
		expect(onFeatureProgress).toHaveBeenNthCalledWith(2, featureId, "Ready.");

		// Late calls (async task that finished after boot) must be silent no-ops.
		capturedSdk?.boot.reportProgress("late — should be ignored");
		expect(onFeatureProgress).toHaveBeenCalledTimes(2);

		dispose();
	});

	it("awaits async mainRegister and delivers progress throughout", async () => {
		const featureId = "registry-async-boot-test";
		const onFeatureProgress = vi.fn();

		const dispose = await bootFeatures(
			[
				{
					id: featureId,
					async mainRegister(mainSdk) {
						mainSdk.boot.reportProgress("Starting async boot…");
						await new Promise((resolve) => setTimeout(resolve, 10));
						mainSdk.boot.reportProgress("Async boot done.");
					},
				},
			],
			{ onFeatureProgress },
		);

		expect(onFeatureProgress).toHaveBeenNthCalledWith(1, featureId, "Starting async boot…");
		expect(onFeatureProgress).toHaveBeenNthCalledWith(2, featureId, "Async boot done.");
		dispose();
	});

	it("rolls back async mainRegister that rejects", async () => {
		const featureId = "registry-async-rollback-test";
		const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const dispose = await bootFeatures([
			{
				id: featureId,
				async mainRegister() {
					await new Promise((resolve) => setTimeout(resolve, 5));
					throw new Error("async boot failed");
				},
			},
		]);

		expect(logging).toHaveBeenCalledWith(
			expect.stringContaining(`mainRegister failed for "${featureId}"`),
			expect.any(Error),
		);
		dispose();

		// Feature can be retried after async failure
		const registered = vi.fn();
		const retryDispose = await bootFeatures([{ id: featureId, mainRegister: registered }]);
		expect(registered).toHaveBeenCalledOnce();
		retryDispose();
	});
});

describe("feature event bridge", () => {
	it("delivers renderer events to main subscribers and relays with the origin id", () => {
		const listener = vi.fn();
		const relay = vi.fn();
		const unsubscribe = featureRouter.eventBus.on("renderer-source.changed", listener);
		const event = {
			featureId: "renderer-source",
			name: "changed",
			payload: { id: "1" },
		};

		createFeatureMessageHandlers(relay)["feature:event"](event, { senderId: 42 });

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith({ id: "1" });
		expect(relay).toHaveBeenCalledOnce();
		expect(relay).toHaveBeenCalledWith(event, 42);
		unsubscribe();
	});

	it("snapshots the relay before main subscribers can mutate the payload", () => {
		const relay = vi.fn();
		const unsubscribe = featureRouter.eventBus.on("renderer-source.changed", (payload) => {
			(payload as { id: string }).id = "mutated";
		});
		const event = {
			featureId: "renderer-source",
			name: "changed",
			payload: { id: "original" },
		};

		createFeatureMessageHandlers(relay)["feature:event"](event, { senderId: 42 });

		expect(event.payload.id).toBe("mutated");
		expect(relay).toHaveBeenCalledWith(
			{
				featureId: "renderer-source",
				name: "changed",
				payload: { id: "original" },
			},
			42,
		);
		unsubscribe();
	});

	it("delivers locally when no renderer relay is configured", () => {
		const listener = vi.fn();
		const unsubscribe = featureRouter.eventBus.on("renderer-source.local", listener);

		createFeatureMessageHandlers()["feature:event"](
			{ featureId: "renderer-source", name: "local", payload: 1 },
			{ senderId: 42 },
		);

		expect(listener).toHaveBeenCalledWith(1);
		unsubscribe();
	});
});

describe("feature invoke bridge", () => {
	it("returns values and translates only FeatureError into BusinessError", async () => {
		const featureId = "feature-invoke-bridge-test";
		const channels = {
			run: defineMethod(z.enum(["success", "expected", "unexpected"]), z.string()),
		} as const;
		const unexpected = new Error("unexpected");
		const dispose = await bootFeatures([
			{
				id: featureId,
				mainRegister(mainSdk) {
					mainSdk.channels(channels).handle("run", (mode) => {
						if (mode === "expected") throw new FeatureError("missing", "NOT_FOUND");
						if (mode === "unexpected") throw unexpected;
						return "done";
					});
				},
			},
		]);
		const invoke = createFeatureHandlers()["feature:invoke"];

		try {
			await expect(invoke({ featureId, channel: "run", args: "success" })).resolves.toBe("done");
			await expect(invoke({ featureId, channel: "run", args: "expected" })).rejects.toEqual(
				new BusinessError("[NOT_FOUND] missing"),
			);
			await expect(invoke({ featureId, channel: "run", args: "unexpected" })).rejects.toBe(
				unexpected,
			);
		} finally {
			dispose();
		}
	});
});

describe("feature port bridge", () => {
	it("attaches the transferred port to the owning feature handler", async () => {
		const featureId = "feature-port-bridge-test";
		const attached = vi.fn();
		const port = {} as never;
		const dispose = await bootFeatures([
			{
				id: featureId,
				mainRegister(mainSdk) {
					mainSdk.ports.handle("runtime", z.object({ notebookId: z.string() }), attached);
				},
			},
		]);

		try {
			await createFeaturePortHandlers()["feature:port"](
				{
					type: "anaconda-agentic-desktop:feature-port",
					featureId,
					channel: "runtime",
					args: { notebookId: "nb-1" },
				},
				{ senderId: 42, port },
			);
			expect(attached).toHaveBeenCalledWith(port, { notebookId: "nb-1" });
		} finally {
			await dispose();
		}
	});
});

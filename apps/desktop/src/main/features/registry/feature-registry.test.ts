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
	it("wires feature options, skips duplicate boots, and disposes successful registrations", () => {
		const storageRoot = mkdtempSync(path.join(tmpdir(), "feature-registry-"));
		directories.push(storageRoot);
		const relay = vi.fn();
		const disposed = vi.fn();
		const resolveAsset = vi.fn((subpath: string) => `/plugin/${subpath}`);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const featureId = "registry-options-test";
		const registration = {
			id: featureId,
			resolveAsset,
			mainRegister(mainSdk: MainSdk) {
				expect(mainSdk.storageDir).toBe(path.join(storageRoot, "plugins", featureId));
				expect(mainSdk.resolvePluginAsset("migrations")).toBe("/plugin/migrations");
				mainSdk.events.emit("ready", { id: "1" });
				mainSdk.onDispose(disposed);
			},
		};

		const dispose = bootFeatures([registration], { emitEvent: relay, storageRoot });
		const duplicateDispose = bootFeatures([registration], { emitEvent: relay, storageRoot });

		expect(relay).toHaveBeenCalledWith({
			featureId,
			name: "ready",
			payload: { id: "1" },
		});
		expect(resolveAsset).toHaveBeenCalledWith("migrations");
		expect(warning).toHaveBeenCalledWith(expect.stringContaining("is already booted"));
		duplicateDispose();
		expect(disposed).not.toHaveBeenCalled();

		dispose();
		expect(disposed).toHaveBeenCalledOnce();
	});

	it("rolls back failed registrations and allows a later retry", () => {
		const featureId = "registry-rollback-test";
		const disposed = vi.fn();
		const error = new Error("registration failed");
		const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const failedDispose = bootFeatures([
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
		const retryDispose = bootFeatures([{ id: featureId, mainRegister: registered }]);
		expect(registered).toHaveBeenCalledOnce();
		retryDispose();
	});

	it("invokes onBeforeFeatureBoot callback for each feature before mainRegister", () => {
		const featureId = "registry-progress-test";
		const progress = vi.fn();
		const registerOrder: string[] = [];

		const dispose = bootFeatures(
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
		const dispose = bootFeatures([
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

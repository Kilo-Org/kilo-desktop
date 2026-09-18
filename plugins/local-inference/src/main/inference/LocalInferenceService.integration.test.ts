import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { KvStore } from "@kilo-desktop/feature-sdk";

import type { LocalModel } from "../../contracts/schemas.js";
import { LocalInferenceService } from "./LocalInferenceService.js";
import type { LlamaRouterStatus } from "../runtime/LlamaRouterManager.js";
import { LocalModelRegistry, type PersistedLocalModels } from "../models/LocalModelRegistry.js";

const roots: string[] = [];

function store(): KvStore<PersistedLocalModels> {
	let value: PersistedLocalModels = { models: [] };
	return {
		snapshot: () => structuredClone(value),
		get: (key) => structuredClone(value[key]),
		set: (patch) => {
			value = { ...value, ...structuredClone(patch) };
			return structuredClone(value);
		},
		clear: () => {
			value = { models: [] };
		},
	};
}

async function fixture(): Promise<string> {
	const root = path.join(tmpdir(), `local-service-${crypto.randomUUID()}`);
	roots.push(root);
	await mkdir(root, { recursive: true });
	const file = path.join(root, "Tiny.gguf");
	await writeFile(file, "GGUF");
	return file;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalInferenceService", () => {
	it("deletes only explicitly managed GGUF files inside the models directory", async () => {
		const file = await fixture();
		const modelsDir = path.dirname(file);
		const registry = new LocalModelRegistry(store(), () => 1);
		const ensureRunning = vi.fn(async () => null);
		const service = new LocalInferenceService({
			registry,
			managedModelsDir: modelsDir,
			router: {
				apiKey: "secret",
				status: { status: "ready", loadedModelIds: [] },
				ensureRunning,
				restart: async () => null,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		const model = await service.add({
			path: file,
			catalog: { modelId: "catalog-model", quantizationId: "q4" },
			managedFile: true,
			sizeBytes: 4,
		});

		await expect(service.remove(model.id, "delete-managed-file")).resolves.toBe(true);

		await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
		expect(service.list()).toEqual([]);
		expect(ensureRunning).toHaveBeenCalledWith([], {});
	});

	it("keeps queued reconciles behind managed file removal", async () => {
		const file = await fixture();
		const registry = new LocalModelRegistry(store(), () => 1);
		const model = await registry.add(file, undefined, undefined, {
			managedFile: true,
			sizeBytes: 4,
		});
		registry.setEnabled(true);
		let finishRelease: (() => void) | undefined;
		const ensureRunning = vi
			.fn(async (_models: readonly LocalModel[]) => ({
				baseUrl: "http://127.0.0.1:43123",
				port: 43123,
			}))
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finishRelease = () => resolve({ baseUrl: "http://127.0.0.1:43123", port: 43123 });
					}),
			);
		const service = new LocalInferenceService({
			registry,
			managedModelsDir: path.dirname(file),
			router: {
				apiKey: "secret",
				status: { status: "ready", loadedModelIds: [model.id] },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});

		const removal = service.remove(model.id, "delete-managed-file");
		await vi.waitFor(() => expect(finishRelease).toBeTypeOf("function"));
		const queuedReconcile = service.reconcile();
		finishRelease?.();

		await expect(removal).resolves.toBe(true);
		await expect(queuedReconcile).resolves.toBeUndefined();
		expect(
			ensureRunning.mock.calls.every(([models]) => models.every((entry) => entry.id !== model.id)),
		).toBe(true);
	});

	it("reports a completed removal when the follow-up reconcile fails", async () => {
		const file = await fixture();
		const registry = new LocalModelRegistry(store(), () => 1);
		const model = await registry.add(file);
		registry.setEnabled(true);
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning: async () => {
					throw new Error("Router unavailable");
				},
				restart: async () => null,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger,
		});

		await expect(service.remove(model.id, "registry-only")).resolves.toBe(true);

		expect(service.list()).toEqual([]);
		expect(logger.error).toHaveBeenCalledWith(
			"Local inference reconcile failed: Router unavailable",
		);
		expect(service.status).toEqual({
			status: "error",
			message: "Local inference could not be configured. Check the app logs and try again.",
		});
	});

	it("refuses to delete imported files and managed paths outside its models directory", async () => {
		const importedFile = await fixture();
		const managedRoot = path.join(tmpdir(), `managed-models-${crypto.randomUUID()}`);
		roots.push(managedRoot);
		await mkdir(managedRoot, { recursive: true });
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			managedModelsDir: managedRoot,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning: async () => null,
				restart: async () => null,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		const imported = await service.add({ path: importedFile });

		await expect(service.remove(imported.id, "delete-managed-file")).rejects.toThrow(
			"Only models downloaded from the catalog",
		);
		await expect(readFile(importedFile)).resolves.toEqual(Buffer.from("GGUF"));

		const mislabeled = await registry.add(importedFile, undefined, undefined, {
			managedFile: true,
		});
		await expect(service.remove(mislabeled.id, "delete-managed-file")).rejects.toThrow(
			"outside the local models folder",
		);
		await expect(readFile(importedFile)).resolves.toEqual(Buffer.from("GGUF"));
	});

	it("reconciles registered models into one managed Kilo provider", async () => {
		const set = vi.fn(async () => {});
		const remove = vi.fn(async () => {});
		const contribute = vi.fn(() => vi.fn());
		const ensureRunning = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:43123",
			port: 43123,
		}));
		const ensureProxy = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:44123",
			port: 44123,
		}));
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: ensureProxy,
				ensureRunning: ensureProxy,
				close() {},
			},
			getKilo: () => ({
				kiloService: {
					serverEnv: { contribute },
					providerConfig: { set, remove },
				},
			}),
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});

		const model = await service.add({ path: await fixture() });
		await service.reconcile();

		expect(contribute).toHaveBeenCalledOnce();
		expect(ensureProxy).toHaveBeenCalledWith("http://127.0.0.1:43123", undefined, "127.0.0.1");
		expect(set).toHaveBeenLastCalledWith(
			"local-inference",
			"anaconda-local",
			expect.objectContaining({
				name: "Local",
				options: expect.objectContaining({ baseURL: "http://127.0.0.1:44123/v1" }),
				models: { [model.id]: expect.objectContaining({ name: "Tiny" }) },
			}),
		);

		await expect(service.remove(model.id, "registry-only")).resolves.toBe(true);
		await service.reconcile();
		expect(remove).toHaveBeenLastCalledWith("local-inference", "anaconda-local");
	});

	it("persists model settings and reconciles them into the router preset", async () => {
		const ensureRunning = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:43123",
			port: 43123,
		}));
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				ensureRunning: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		const model = await service.add({ path: await fixture() });
		await service.reconcile();
		ensureRunning.mockClear();

		const updated = service.update(model.id, {
			temperature: 0.2,
			contextLength: 8192,
			maxResponseTokens: 2048,
			llamaFlags: { "n-gpu-layers": "99" },
		});
		await service.reconcile();

		expect(updated.settings).toEqual({
			temperature: 0.2,
			contextLength: 8192,
			maxResponseTokens: 2048,
			llamaFlags: { "n-gpu-layers": "99" },
		});
		expect(ensureRunning).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					id: model.id,
					settings: {
						temperature: 0.2,
						contextLength: 8192,
						maxResponseTokens: 2048,
						llamaFlags: { "n-gpu-layers": "99" },
					},
				}),
			],
			{},
		);
	});

	it("exposes OpenAI-compatible connection details while the local server is ready", async () => {
		const registry = new LocalModelRegistry(store());
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "ready", loadedModelIds: [] },
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:43123", port: 43123 }),
				restart: async () => ({ baseUrl: "http://127.0.0.1:43123", port: 43123 }),
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				port: 44123,
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});

		expect(service.status).toEqual({
			status: "ready",
			loadedModelIds: [],
			connection: {
				port: 44123,
				baseUrl: "http://127.0.0.1:44123/v1",
				apiKey: "secret",
			},
		});
	});

	it("gates prompt preparation on the selected registered model", async () => {
		const prepareModel = vi.fn(async () => {});
		const registry = new LocalModelRegistry(store());
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "ready", loadedModelIds: [] },
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:43123", port: 43123 }),
				restart: async () => ({ baseUrl: "http://127.0.0.1:43123", port: 43123 }),
				prepareModel,
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		const model = await service.add({ path: await fixture() });

		await service.prepareModel(model.id);

		expect(prepareModel).toHaveBeenCalledWith(model.id, [model]);
	});

	it("does not strip the managed provider during initialize", async () => {
		const set = vi.fn(async () => {});
		const remove = vi.fn(async () => {});
		const ensureRunning = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:43123",
			port: 43123,
		}));
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				ensureRunning: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				close() {},
			},
			getKilo: () => ({
				kiloService: {
					serverEnv: { contribute: vi.fn(() => vi.fn()) },
					providerConfig: { set, remove },
				},
			}),
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		await service.add({ path: await fixture() });
		await service.reconcile();
		set.mockClear();
		remove.mockClear();

		await service.initialize();
		await service.reconcile();

		expect(remove).not.toHaveBeenCalled();
		expect(set).toHaveBeenCalled();
	});

	it("starts the router on initialize when models are registered even after a previous stop", async () => {
		const ensureRunning = vi.fn(async (models: readonly { id: string }[]) => {
			if (models.length === 0) return null;
			return { baseUrl: "http://127.0.0.1:43123", port: 43123 };
		});
		const set = vi.fn(async () => {});
		const registry = new LocalModelRegistry(store(), () => 1);
		const model = await registry.add(await fixture());
		registry.setEnabled(false);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				ensureRunning: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				close() {},
			},
			getKilo: () => ({
				kiloService: {
					serverEnv: { contribute: vi.fn(() => vi.fn()) },
					providerConfig: { set, remove: vi.fn(async () => {}) },
				},
			}),
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});

		expect(service.status).toEqual({ status: "disconnected" });

		await service.initialize();
		await service.reconcile();

		expect(ensureRunning).toHaveBeenCalledWith([expect.objectContaining({ id: model.id })], {});
		expect(set).toHaveBeenCalled();
		expect(service.status).not.toEqual({ status: "disconnected" });
	});

	it("starts the router when a model is added after stop", async () => {
		const ensureRunning = vi.fn(async (models: readonly { id: string }[]) => {
			if (models.length === 0) return null;
			return { baseUrl: "http://127.0.0.1:43123", port: 43123 };
		});
		const set = vi.fn(async () => {});
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				ensureRunning: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				close() {},
			},
			getKilo: () => ({
				kiloService: {
					serverEnv: { contribute: vi.fn(() => vi.fn()) },
					providerConfig: { set, remove: vi.fn(async () => {}) },
				},
			}),
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		const first = await service.add({ path: await fixture() });
		await service.reconcile();
		await service.disconnect();
		ensureRunning.mockClear();
		set.mockClear();

		const second = await service.add({ path: await fixture() });
		await service.reconcile();

		expect(second.id).not.toBe(first.id);
		expect(ensureRunning).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ id: first.id }),
				expect.objectContaining({ id: second.id }),
			]),
			{},
		);
		expect(set).toHaveBeenCalled();
		expect(service.status).not.toEqual({ status: "disconnected" });
	});

	it("starts the router during initialize without loading weights", async () => {
		const ensureRunning = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:43123",
			port: 43123,
		}));
		const prepareModel = vi.fn(async () => {});
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning,
				restart: ensureRunning,
				prepareModel,
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				ensureRunning: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				close() {},
			},
			getKilo: () => ({
				kiloService: {
					serverEnv: { contribute: vi.fn(() => vi.fn()) },
					providerConfig: { set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
				},
			}),
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		await service.add({ path: await fixture() });
		prepareModel.mockClear();
		ensureRunning.mockClear();

		await service.initialize();
		await service.reconcile();

		expect(ensureRunning).toHaveBeenCalled();
		expect(prepareModel).not.toHaveBeenCalled();
	});

	it("registers the managed provider before llama-server finishes starting", async () => {
		const ensureRunning = vi.fn(() => new Promise<{ baseUrl: string; port: number }>(() => {}));
		const set = vi.fn(async () => {});
		const ensureListening = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:44123",
			port: 44123,
		}));
		const registry = new LocalModelRegistry(store(), () => 1);
		await registry.add(await fixture());
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "idle" },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				ensureListening,
				ensureRunning: ensureListening,
				close() {},
			},
			getKilo: () => ({
				kiloService: {
					serverEnv: { contribute: vi.fn(() => vi.fn()) },
					providerConfig: { set, remove: vi.fn(async () => {}) },
				},
			}),
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});

		await expect(
			Promise.race([
				service.initialize(),
				new Promise((_, reject) => {
					setTimeout(() => reject(new Error("initialize waited for llama-server")), 1000);
				}),
			]),
		).resolves.toBeUndefined();

		expect(ensureListening).toHaveBeenCalled();
		expect(set).toHaveBeenCalledWith(
			"local-inference",
			"anaconda-local",
			expect.objectContaining({
				options: expect.objectContaining({ baseURL: "http://127.0.0.1:44123/v1" }),
			}),
		);
		service.dispose();
	});

	it("loads a selected model without re-reconciling when the router is already ready", async () => {
		const set = vi.fn(async () => {});
		const ensureRunning = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:43123",
			port: 43123,
		}));
		const prepareModel = vi.fn(async () => {});
		const registry = new LocalModelRegistry(store());
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "ready", loadedModelIds: [] },
				ensureRunning,
				restart: ensureRunning,
				prepareModel,
				dispose() {},
			},
			proxy: {
				ensureListening: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				ensureRunning: async () => ({
					baseUrl: "http://127.0.0.1:44123",
					port: 44123,
				}),
				close() {},
			},
			getKilo: () => ({
				kiloService: {
					serverEnv: { contribute: vi.fn(() => vi.fn()) },
					providerConfig: { set, remove: vi.fn(async () => {}) },
				},
			}),
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		const model = await service.add({ path: await fixture() });
		await service.reconcile();
		ensureRunning.mockClear();
		set.mockClear();
		prepareModel.mockClear();

		await service.prepareModel(model.id);

		expect(prepareModel).toHaveBeenCalledWith(model.id, [model]);
		expect(ensureRunning).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
	});

	it("disconnects by unregistering the provider while keeping registered models", async () => {
		const set = vi.fn(async () => {});
		const remove = vi.fn(async () => {});
		const close = vi.fn();
		const router = {
			apiKey: "secret",
			status: { status: "ready", loadedModelIds: [] } as LlamaRouterStatus,
			ensureRunning: vi.fn(async (models: readonly { id: string }[]) => {
				if (models.length === 0) {
					router.status = { status: "idle" };
					return null;
				}
				router.status = { status: "ready", loadedModelIds: [] };
				return { baseUrl: "http://127.0.0.1:43123", port: 43123 };
			}),
			prepareModel: async () => {},
			dispose() {},
			restart: async (models: readonly { id: string }[]) => router.ensureRunning(models),
		};
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router,
			proxy: {
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close,
			},
			getKilo: () => ({
				kiloService: {
					serverEnv: { contribute: vi.fn(() => vi.fn()) },
					providerConfig: { set, remove },
				},
			}),
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		const model = await service.add({ path: await fixture() });
		await service.reconcile();
		set.mockClear();
		remove.mockClear();
		router.ensureRunning.mockClear();
		close.mockClear();

		await service.disconnect();

		expect(service.list()).toEqual([expect.objectContaining({ id: model.id })]);
		expect(service.status).toEqual({ status: "disconnected" });
		expect(close).toHaveBeenCalled();
		expect(router.ensureRunning).toHaveBeenCalledWith([]);
		expect(remove).toHaveBeenCalledWith("local-inference", "anaconda-local");
		expect(set).not.toHaveBeenCalled();

		await service.connect();
		expect(service.status).not.toEqual({ status: "disconnected" });
		expect(set).toHaveBeenCalledWith(
			"local-inference",
			"anaconda-local",
			expect.objectContaining({ name: "Local" }),
		);
	});

	it("reports stopping while the router is still shutting down after stop", async () => {
		const registry = new LocalModelRegistry(store(), () => 1);
		await registry.add(await fixture());
		registry.setEnabled(false);
		const router = {
			apiKey: "secret",
			status: { status: "stopping" } as LlamaRouterStatus,
			ensureRunning: vi.fn(async () => null),
			restart: vi.fn(async () => null),
			prepareModel: async () => {},
			dispose() {},
		};
		const service = new LocalInferenceService({
			registry,
			router,
			proxy: {
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});

		expect(service.status).toEqual({ status: "stopping" });
		router.status = { status: "idle" };
		expect(service.status).toEqual({ status: "disconnected" });
	});

	it("applies server settings to the router and public listen port", async () => {
		const ensureRunning = vi.fn(async (models: readonly { id: string }[]) => {
			if (models.length === 0) return null;
			return { baseUrl: "http://127.0.0.1:43123", port: 43123 };
		});
		const ensureListening = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:8080",
			port: 8080,
		}));
		const ensureProxy = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:8080",
			port: 8080,
		}));
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "ready", loadedModelIds: [] },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				port: 8080,
				ensureListening,
				ensureRunning: ensureProxy,
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		const model = await service.add({ path: await fixture() });
		await service.reconcile();
		ensureRunning.mockClear();
		ensureListening.mockClear();
		ensureProxy.mockClear();

		expect(service.updateServerSettings({ port: 8080, modelLoadMode: "all" })).toEqual({
			port: 8080,
			modelLoadMode: "all",
		});
		await service.reconcile();

		expect(ensureRunning).toHaveBeenCalledWith([expect.objectContaining({ id: model.id })], {
			modelLoadMode: "all",
		});
		expect(ensureListening).toHaveBeenCalledWith(8080, "127.0.0.1");
		expect(ensureProxy).toHaveBeenCalledWith("http://127.0.0.1:43123", 8080, "127.0.0.1");
	});

	it("binds the public proxy to the LAN and advertises the LAN address", async () => {
		const ensureRunning = vi.fn(async (models: readonly { id: string }[]) => {
			if (models.length === 0) return null;
			return { baseUrl: "http://127.0.0.1:43123", port: 43123 };
		});
		const ensureListening = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:8080",
			port: 8080,
		}));
		const ensureProxy = vi.fn(async () => ({
			baseUrl: "http://127.0.0.1:8080",
			port: 8080,
		}));
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "ready", loadedModelIds: [] },
				ensureRunning,
				restart: ensureRunning,
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				port: 8080,
				ensureListening,
				ensureRunning: ensureProxy,
				close() {},
			},
			networkInterfaces: () => ({
				en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
			}),
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		await service.add({ path: await fixture() });
		await service.reconcile();
		ensureRunning.mockClear();
		ensureListening.mockClear();
		ensureProxy.mockClear();

		expect(service.updateServerSettings({ serveOnLocalNetwork: true })).toEqual({
			serveOnLocalNetwork: true,
		});
		await service.reconcile();

		expect(ensureRunning).toHaveBeenCalledWith(
			[expect.objectContaining({ id: expect.any(String) })],
			{},
		);
		expect(ensureListening).toHaveBeenCalledWith(undefined, "0.0.0.0");
		expect(ensureProxy).toHaveBeenCalledWith("http://127.0.0.1:43123", undefined, "0.0.0.0");
		expect(service.status).toEqual({
			status: "ready",
			loadedModelIds: [],
			connection: {
				port: 8080,
				baseUrl: "http://192.168.1.20:8080/v1",
				apiKey: "secret",
			},
		});
	});

	it("reads host NICs when LAN serving is on and no probe is injected", async () => {
		const registry = new LocalModelRegistry(store(), () => 1);
		const service = new LocalInferenceService({
			registry,
			router: {
				apiKey: "secret",
				status: { status: "ready", loadedModelIds: [] },
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:43123", port: 43123 }),
				restart: async () => ({ baseUrl: "http://127.0.0.1:43123", port: 43123 }),
				prepareModel: async () => {},
				dispose() {},
			},
			proxy: {
				port: 8080,
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:8080", port: 8080 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:8080", port: 8080 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		await service.add({ path: await fixture() });
		service.updateServerSettings({ serveOnLocalNetwork: true });

		const status = service.status;
		expect(status).toMatchObject({
			status: "ready",
			connection: {
				port: 8080,
				apiKey: "secret",
			},
		});
		expect(status.status === "ready" ? status.connection?.baseUrl : undefined).toMatch(
			/^http:\/\/.+:8080\/v1$/,
		);
	});

	it("keeps a failed router status instead of a generic configuration error", async () => {
		const ensureRunning = vi.fn(async (models: readonly { id: string }[]) => {
			if (models.length === 0) return null;
			throw new Error("llama-server exited before becoming healthy.");
		});
		const router = {
			apiKey: "secret",
			status: {
				status: "error" as const,
				message: "Local inference could not start. Check the model files and try again.",
			},
			ensureRunning,
			restart: ensureRunning,
			prepareModel: async () => {},
			dispose() {},
		};
		const service = new LocalInferenceService({
			registry: new LocalModelRegistry(store(), () => 1),
			router,
			proxy: {
				ensureListening: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				ensureRunning: async () => ({ baseUrl: "http://127.0.0.1:44123", port: 44123 }),
				close() {},
			},
			getKilo: () => null,
			emit: vi.fn(),
			logger: { info() {}, warn() {}, error() {} },
		});
		await service.add({ path: await fixture() });

		await expect(service.connect()).rejects.toThrow("llama-server exited before becoming healthy.");
		expect(service.status).toEqual({
			status: "error",
			message: "Local inference could not start. Check the model files and try again.",
		});
	});
});

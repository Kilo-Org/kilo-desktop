import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalModel, ModelDownload } from "../../contracts";
import { ModelDownloadManager, type ModelDownloadManagerOptions } from "./ModelDownloadManager";
import type { CatalogDownloadArtifact } from "./catalog-download";

const roots: string[] = [];

const logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

function artifact(
	overrides: Partial<CatalogDownloadArtifact> = {},
	bytes = Buffer.from("GGUF-model-data"),
): CatalogDownloadArtifact {
	return {
		modelId: "catalog-model",
		quantizationId: "catalog-model-q4",
		modelName: "Catalog Model",
		publisher: "google",
		quantization: "Q4_K_M",
		sizeBytes: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		...overrides,
	};
}

function artifactIdentitySuffix(entry: CatalogDownloadArtifact): string {
	return createHash("sha256")
		.update(`${entry.modelId}\u0000${entry.quantizationId}`)
		.digest("hex")
		.slice(0, 16);
}

async function setup(
	overrides: Partial<ModelDownloadManagerOptions> = {},
	artifacts: CatalogDownloadArtifact[] = [artifact()],
) {
	const root = await mkdtemp(path.join(tmpdir(), "model-download-manager-"));
	roots.push(root);
	const modelsDir = path.join(root, "models");
	const events: ModelDownload[] = [];
	const addModel = vi.fn(
		async (input: Parameters<ModelDownloadManagerOptions["addModel"]>[0]): Promise<LocalModel> => ({
			id: "downloaded-model",
			name: input.name,
			path: input.path,
			available: true,
			addedAt: 1,
			catalog: input.catalog,
		}),
	);
	const manager = new ModelDownloadManager({
		modelsDir,
		fetch: async () => new Response(Buffer.from("GGUF-model-data")),
		resolveArtifact: async (identity) => {
			const match = artifacts.find(
				(entry) =>
					entry.modelId === identity.modelId && entry.quantizationId === identity.quantizationId,
			);
			if (!match) throw new Error("missing artifact");
			return match;
		},
		resolveDownloadUrl: async () => "https://download.example.test/model.gguf",
		addModel,
		emit: (event) => events.push(event),
		logger,
		...overrides,
	});
	await manager.initialize();
	return { manager, root, modelsDir, events, addModel };
}

async function waitForStatus(manager: ModelDownloadManager, status: ModelDownload["status"]) {
	await vi.waitFor(
		() => {
			const downloads = manager.list();
			expect(
				downloads.some((entry) => entry.status === status),
				`Expected ${status}; current downloads: ${JSON.stringify(downloads)}`,
			).toBe(true);
		},
		{ timeout: 10_000 },
	);
}

afterEach(async () => {
	vi.clearAllMocks();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ModelDownloadManager", () => {
	it("streams, verifies, promotes, and registers a catalog model", async () => {
		const bytes = Buffer.from("GGUF-model-data");
		const first = bytes.subarray(0, 5);
		const second = bytes.subarray(5);
		const { manager, modelsDir, events, addModel } = await setup({
			fetch: async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(first);
							controller.enqueue(second);
							controller.close();
						},
					}),
				),
		});

		await expect(
			manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" }),
		).resolves.toMatchObject({ status: "downloading", percentage: 0 });
		await waitForStatus(manager, "completed");

		const destination = path.join(
			modelsDir,
			`Catalog-Model_Q4_K_M_${artifactIdentitySuffix(artifact())}.gguf`,
		);
		expect(await readFile(destination)).toEqual(bytes);
		expect(await readdir(modelsDir)).toEqual([
			`Catalog-Model_Q4_K_M_${artifactIdentitySuffix(artifact())}.gguf`,
		]);
		expect(addModel).toHaveBeenCalledWith({
			path: destination,
			name: "Catalog Model (Q4_K_M)",
			catalog: {
				modelId: "catalog-model",
				quantizationId: "catalog-model-q4",
				publisher: "google",
			},
			managedFile: true,
			sizeBytes: bytes.byteLength,
		});
		expect(events.map((event) => event.percentage)).toEqual([0, 33, 99, 100]);
	});

	it("removes a promoted artifact when model registration fails", async () => {
		const addModel = vi.fn(async () => {
			throw new Error("Registry unavailable");
		});
		const { manager, modelsDir } = await setup({ addModel });

		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await waitForStatus(manager, "failed");

		expect(await readdir(modelsDir)).toEqual([]);
	});

	it("cancels signed-url resolution and removes the partial", async () => {
		const resolveDownloadUrl = vi.fn(
			async (_artifact: CatalogDownloadArtifact, signal: AbortSignal) =>
				new Promise<string>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
		);
		const { manager, modelsDir, events, addModel } = await setup({ resolveDownloadUrl });
		const identity = { modelId: "catalog-model", quantizationId: "catalog-model-q4" };
		await manager.start(identity);
		await vi.waitFor(() => expect(resolveDownloadUrl).toHaveBeenCalledOnce());

		expect(manager.cancel(identity)).toMatchObject({ status: "cancelling" });
		expect(manager.cancel(identity)).toMatchObject({ status: "cancelling" });
		await waitForStatus(manager, "cancelled");

		expect(events.slice(-2).map((event) => event.status)).toEqual(["cancelling", "cancelled"]);
		expect(await readdir(modelsDir)).toEqual([]);
		expect(addModel).not.toHaveBeenCalled();
	});

	it("does not let a late cancellation delete an artifact being registered", async () => {
		let finishRegistration: (() => void) | undefined;
		const addModel = vi.fn(
			(input: Parameters<ModelDownloadManagerOptions["addModel"]>[0]) =>
				new Promise<LocalModel>((resolve) => {
					finishRegistration = () =>
						resolve({
							id: "downloaded-model",
							name: input.name,
							path: input.path,
							available: true,
							addedAt: 1,
							catalog: input.catalog,
						});
				}),
		);
		const { manager, modelsDir } = await setup({ addModel });
		const identity = { modelId: "catalog-model", quantizationId: "catalog-model-q4" };

		await manager.start(identity);
		await vi.waitFor(() => expect(addModel).toHaveBeenCalledOnce());
		expect(manager.cancel(identity)).toMatchObject({ status: "downloading", percentage: 99 });
		finishRegistration?.();
		await waitForStatus(manager, "completed");

		expect(manager.cancel(identity)).toMatchObject({ status: "completed", percentage: 100 });
		expect(await readdir(modelsDir)).toEqual([
			`Catalog-Model_Q4_K_M_${artifactIdentitySuffix(artifact())}.gguf`,
		]);
	});

	it("aborts an in-flight stream and restarts cancelled work from zero", async () => {
		let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							streamController = controller;
							controller.enqueue(Buffer.from("GGUF"));
						},
						cancel() {
							streamController = undefined;
						},
					}),
				),
			)
			.mockResolvedValueOnce(new Response(Buffer.from("GGUF-model-data")));
		const { manager, modelsDir, addModel } = await setup({ fetch });
		const identity = { modelId: "catalog-model", quantizationId: "catalog-model-q4" };
		await manager.start(identity);
		await vi.waitFor(() => expect(manager.list()[0]?.transferredBytes).toBe(4));

		manager.cancel(identity);
		await waitForStatus(manager, "cancelled");
		expect(streamController).toBeUndefined();
		expect(await readdir(modelsDir)).toEqual([]);

		await expect(manager.start(identity)).resolves.toMatchObject({ percentage: 0 });
		await waitForStatus(manager, "completed");
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(addModel).toHaveBeenCalledOnce();
	});

	it("deduplicates identical starts while allowing distinct artifacts in parallel", async () => {
		const secondBytes = Buffer.from("GGUF-second-model");
		const artifacts = [
			artifact(),
			artifact(
				{
					modelId: "second-model",
					quantizationId: "second-q8",
					modelName: "Second Model",
					quantization: "Q8_0",
				},
				secondBytes,
			),
		];
		const fetch = vi.fn(async (url: string | URL | Request) => {
			const bytes = String(url).includes("second") ? secondBytes : Buffer.from("GGUF-model-data");
			return new Response(bytes);
		});
		const { manager, addModel } = await setup(
			{
				fetch,
				resolveDownloadUrl: async (entry) => `https://download.example.test/${entry.modelId}.gguf`,
			},
			artifacts,
		);

		const firstIdentity = { modelId: "catalog-model", quantizationId: "catalog-model-q4" };
		await Promise.all([
			manager.start(firstIdentity),
			manager.start(firstIdentity),
			manager.start({ modelId: "second-model", quantizationId: "second-q8" }),
		]);
		await vi.waitFor(() => expect(addModel).toHaveBeenCalledTimes(2));

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(manager.list().filter((entry) => entry.status === "completed")).toHaveLength(2);
	});

	it("keeps artifacts with identical display labels in separate files", async () => {
		const firstBytes = Buffer.from("GGUF-first-model");
		const secondBytes = Buffer.from("GGUF-second-model");
		const firstArtifact = artifact({}, firstBytes);
		const secondArtifact = artifact(
			{
				modelId: "second-model",
				quantizationId: "second-model-q4",
			},
			secondBytes,
		);
		const { manager, addModel } = await setup(
			{
				fetch: async (url) =>
					new Response(String(url).includes("second-model") ? secondBytes : firstBytes),
				resolveDownloadUrl: async (entry) => `https://download.example.test/${entry.modelId}.gguf`,
			},
			[firstArtifact, secondArtifact],
		);

		await Promise.all([
			manager.start({
				modelId: firstArtifact.modelId,
				quantizationId: firstArtifact.quantizationId,
			}),
			manager.start({
				modelId: secondArtifact.modelId,
				quantizationId: secondArtifact.quantizationId,
			}),
		]);
		await vi.waitFor(() =>
			expect(manager.list().filter((entry) => entry.status === "completed")).toHaveLength(2),
		);

		const registered = new Map(
			addModel.mock.calls.map(([input]) => [input.catalog.modelId, input.path] as const),
		);
		const firstPath = registered.get(firstArtifact.modelId);
		const secondPath = registered.get(secondArtifact.modelId);
		expect(firstPath).toBeDefined();
		expect(secondPath).toBeDefined();
		expect(firstPath).not.toBe(secondPath);
		await expect(readFile(firstPath!)).resolves.toEqual(firstBytes);
		await expect(readFile(secondPath!)).resolves.toEqual(secondBytes);
	});

	it("rejects corrupt downloads without promoting or registering them", async () => {
		const { manager, modelsDir, events, addModel } = await setup({
			fetch: async () => new Response(Buffer.from("GGUF-corrupt-data")),
		});

		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await waitForStatus(manager, "failed");

		expect(events.at(-1)).toMatchObject({
			status: "failed",
			error: "The downloaded model failed its integrity check.",
		});
		expect(await readdir(modelsDir)).toEqual([]);
		expect(addModel).not.toHaveBeenCalled();
	});

	it("stops streaming as soon as a response exceeds the declared artifact size", async () => {
		const expectedBytes = Buffer.from("GGUF-model-data");
		const oversizedBytes = Buffer.concat([expectedBytes, Buffer.from("-unexpected")]);
		const { manager, modelsDir, events, addModel } = await setup(
			{ fetch: async () => new Response(oversizedBytes) },
			[artifact({}, expectedBytes)],
		);

		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await waitForStatus(manager, "failed");

		expect(events.at(-1)).toMatchObject({
			status: "failed",
			error: "The downloaded model failed its integrity check.",
		});
		expect(await readdir(modelsDir)).toEqual([]);
		expect(addModel).not.toHaveBeenCalled();
	});

	it("rejects a checksum-valid download without a GGUF header", async () => {
		const bytes = Buffer.from("NOPE-model-data");
		const { manager, modelsDir, events, addModel } = await setup(
			{ fetch: async () => new Response(bytes) },
			[artifact({}, bytes)],
		);

		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await waitForStatus(manager, "failed");

		expect(events.at(-1)).toMatchObject({
			status: "failed",
			error: "The downloaded file is not a valid GGUF model.",
		});
		expect(await readdir(modelsDir)).toEqual([]);
		expect(addModel).not.toHaveBeenCalled();
	});

	it("sanitizes disk-space failures", async () => {
		const diskSpaceError = Object.assign(new Error("write failed"), { code: "ENOSPC" });
		const { manager, modelsDir, events, addModel } = await setup({
			fetch: async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(diskSpaceError);
						},
					}),
				),
		});

		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await waitForStatus(manager, "failed");

		expect(events.at(-1)).toMatchObject({
			status: "failed",
			error: "There is not enough disk space to download this model.",
		});
		expect(await readdir(modelsDir)).toEqual([]);
		expect(addModel).not.toHaveBeenCalled();
	});

	it("keeps generated filenames inside the models directory", async () => {
		const unsafeArtifact = artifact({
			modelName: "../Odd: Model",
			quantization: "../Q4\\unsafe",
		});
		const { manager, modelsDir, addModel } = await setup({}, [unsafeArtifact]);

		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await waitForStatus(manager, "completed");

		const destination = path.join(
			modelsDir,
			`Odd-Model_Q4-unsafe_${artifactIdentitySuffix(unsafeArtifact)}.gguf`,
		);
		expect(addModel).toHaveBeenCalledWith(expect.objectContaining({ path: destination }));
		expect(await readdir(modelsDir)).toEqual([
			`Odd-Model_Q4-unsafe_${artifactIdentitySuffix(unsafeArtifact)}.gguf`,
		]);
	});

	it("uses safe filename fallbacks when artifact labels contain no usable characters", async () => {
		const unsafeArtifact = artifact({ modelName: "../", quantization: "??" });
		const { manager, modelsDir, addModel } = await setup({}, [unsafeArtifact]);

		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await waitForStatus(manager, "completed");

		const destination = path.join(
			modelsDir,
			`model_quantized_${artifactIdentitySuffix(unsafeArtifact)}.gguf`,
		);
		expect(addModel).toHaveBeenCalledWith(expect.objectContaining({ path: destination }));
		expect(await readdir(modelsDir)).toEqual([
			`model_quantized_${artifactIdentitySuffix(unsafeArtifact)}.gguf`,
		]);
	});

	it("cleans stale partials and reuses an already verified model", async () => {
		const bytes = Buffer.from("GGUF-model-data");
		const root = await mkdtemp(path.join(tmpdir(), "model-download-manager-stale-"));
		roots.push(root);
		const modelsDir = path.join(root, "models");
		await mkdir(modelsDir, { recursive: true });
		await writeFile(path.join(modelsDir, "stale.gguf.part"), "partial");
		const destinationName = `Catalog-Model_Q4_K_M_${artifactIdentitySuffix(artifact())}.gguf`;
		await writeFile(path.join(modelsDir, destinationName), bytes);
		const fetch = vi.fn();
		const { manager, addModel } = await setup({ modelsDir, fetch });

		expect(await readdir(modelsDir)).toEqual([destinationName]);
		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await waitForStatus(manager, "completed");

		expect(fetch).not.toHaveBeenCalled();
		expect(addModel).toHaveBeenCalledOnce();
	});

	it("aborts and cleans unfinished work during shutdown", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(Buffer.from("GGUF"));
						},
					}),
				),
		);
		const { manager, modelsDir, addModel } = await setup({ fetch });

		await manager.start({ modelId: "catalog-model", quantizationId: "catalog-model-q4" });
		await vi.waitFor(() => expect(manager.list()[0]?.transferredBytes).toBe(4));
		await manager.dispose();

		expect(manager.list()[0]?.status).toBe("cancelled");
		expect(await readdir(modelsDir)).toEqual([]);
		expect(addModel).not.toHaveBeenCalled();
	});

	it("does not start a download when shutdown finishes during artifact resolution", async () => {
		let finishResolution: ((entry: CatalogDownloadArtifact) => void) | undefined;
		const resolveArtifact = vi.fn(
			async () =>
				new Promise<CatalogDownloadArtifact>((resolve) => {
					finishResolution = resolve;
				}),
		);
		const fetch = vi.fn(async () => new Response(Buffer.from("GGUF-model-data")));
		const { manager, addModel } = await setup({ resolveArtifact, fetch });
		const pendingStart = manager.start({
			modelId: "catalog-model",
			quantizationId: "catalog-model-q4",
		});
		await vi.waitFor(() => expect(resolveArtifact).toHaveBeenCalledOnce());

		await manager.dispose();
		finishResolution?.(artifact());

		await expect(pendingStart).rejects.toThrow(
			"Model downloads are unavailable while shutting down.",
		);
		expect(manager.list()).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
		expect(addModel).not.toHaveBeenCalled();
	});

	it("guards unknown downloads and remains disposed after repeated shutdown", async () => {
		const { manager } = await setup();
		const identity = { modelId: "missing-model", quantizationId: "missing-quantization" };

		expect(() => manager.cancel(identity)).toThrow("No matching model download is active.");
		await manager.dispose();
		await manager.dispose();
		await expect(manager.start(identity)).rejects.toThrow(
			"Model downloads are unavailable while shutting down.",
		);
	});
});

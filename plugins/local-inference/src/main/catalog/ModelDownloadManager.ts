import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { MainSdkFetch, MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { LocalModel, ModelDownload } from "../../contracts/schemas.js";
import type { CatalogDownloadArtifact, ModelDownloadIdentity } from "./catalog-download.js";

export interface ModelDownloadManagerOptions {
	readonly modelsDir: string;
	readonly fetch: MainSdkFetch;
	readonly resolveArtifact: (identity: ModelDownloadIdentity) => Promise<CatalogDownloadArtifact>;
	readonly resolveDownloadUrl: (
		artifact: CatalogDownloadArtifact,
		signal: AbortSignal,
	) => Promise<string>;
	readonly addModel: (input: {
		path: string;
		name: string;
		catalog: NonNullable<LocalModel["catalog"]>;
		managedFile: true;
		sizeBytes: number;
	}) => Promise<LocalModel>;
	readonly emit: (download: ModelDownload) => void;
	readonly logger: MainSdkLogger;
}

interface DownloadRecord {
	state: ModelDownload;
	readonly controller: AbortController;
	artifact: CatalogDownloadArtifact;
	cleanupPath: string | undefined;
	committing: boolean;
	task: Promise<void> | undefined;
}

class DownloadFailure extends Error {
	readonly userMessage: string;

	constructor(userMessage: string, cause?: unknown) {
		super(userMessage, cause === undefined ? undefined : { cause });
		this.name = "DownloadFailure";
		this.userMessage = userMessage;
	}
}

function keyFor(identity: ModelDownloadIdentity): string {
	return `${identity.modelId}\u0000${identity.quantizationId}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
	let result = "";
	let bytes = 0;
	for (const character of value) {
		const characterBytes = Buffer.byteLength(character);
		if (bytes + characterBytes > maxBytes) break;
		result += character;
		bytes += characterBytes;
	}
	return result;
}

function safeFileComponent(value: string, fallback: string, maxBytes: number): string {
	const safe = value
		.normalize("NFKC")
		.replace(/[<>:"/\\|?*\p{Cc}]/gu, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[. -]+|[. -]+$/g, "");
	return truncateUtf8(safe, maxBytes) || fallback;
}

function destinationFor(modelsDir: string, artifact: CatalogDownloadArtifact): string {
	const model = safeFileComponent(artifact.modelName, "model", 96);
	const quantization = safeFileComponent(artifact.quantization, "quantized", 64);
	const identity = createHash("sha256").update(keyFor(artifact)).digest("hex").slice(0, 16);
	return path.join(modelsDir, `${model}_${quantization}_${identity}.gguf`);
}

async function sha256File(filePath: string, signal: AbortSignal): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) {
		signal.throwIfAborted();
		hash.update(chunk);
	}
	signal.throwIfAborted();
	return hash.digest("hex");
}

async function hasGgufHeader(filePath: string): Promise<boolean> {
	const file = await open(filePath, "r");
	try {
		const header = Buffer.alloc(4);
		const { bytesRead } = await file.read(header, 0, header.length, 0);
		return bytesRead === header.length && header.toString("ascii") === "GGUF";
	} finally {
		await file.close();
	}
}

async function isCurrentArtifact(
	filePath: string,
	artifact: CatalogDownloadArtifact,
	signal: AbortSignal,
): Promise<boolean> {
	try {
		const details = await stat(filePath);
		if (!details.isFile() || details.size !== artifact.sizeBytes) return false;
		if ((await sha256File(filePath, signal)) !== artifact.sha256) return false;
		return hasGgufHeader(filePath);
	} catch (error) {
		if (signal.aborted) throw error;
		return false;
	}
}

async function* trackDownload(
	source: ReadableStream<Uint8Array>,
	signal: AbortSignal,
	maxBytes: number,
	hash: ReturnType<typeof createHash>,
	onChunk: (bytes: number) => void,
): AsyncGenerator<Uint8Array> {
	const reader = source.getReader();
	let transferredBytes = 0;
	const cancelReader = () => {
		void reader.cancel(signal.reason).catch(() => undefined);
	};
	signal.addEventListener("abort", cancelReader, { once: true });
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) return;
			const bytes = Buffer.from(value);
			transferredBytes += bytes.byteLength;
			if (transferredBytes > maxBytes) {
				const failure = new DownloadFailure("The downloaded model failed its integrity check.");
				void reader.cancel(failure).catch(() => undefined);
				throw failure;
			}
			hash.update(bytes);
			onChunk(bytes.byteLength);
			yield bytes;
		}
	} finally {
		signal.removeEventListener("abort", cancelReader);
		reader.releaseLock();
	}
}

function failureMessage(error: unknown): string {
	if (error instanceof DownloadFailure) return error.userMessage;
	if (error instanceof Error && "code" in error && error.code === "ENOSPC") {
		return "There is not enough disk space to download this model.";
	}
	return "The model could not be downloaded.";
}

/**
 * Owns catalog download jobs for one local-inference plugin lifetime. Jobs are
 * keyed by catalog model and quantization so identical starts share work while
 * distinct artifacts stream concurrently. The manager alone writes the models
 * directory, promotes verified partials, and decides terminal state; callers
 * only observe immutable snapshots and request cancellation.
 */
export class ModelDownloadManager {
	readonly #options: ModelDownloadManagerOptions;
	readonly #records = new Map<string, DownloadRecord>();
	#disposed = false;

	constructor(options: ModelDownloadManagerOptions) {
		this.#options = options;
	}

	async initialize(): Promise<void> {
		await mkdir(this.#options.modelsDir, { recursive: true });
		const entries = await readdir(this.#options.modelsDir, { withFileTypes: true });
		await Promise.all(
			entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".gguf.part"))
				.map((entry) => rm(path.join(this.#options.modelsDir, entry.name), { force: true })),
		);
	}

	list(): ModelDownload[] {
		return [...this.#records.values()].map((record) => structuredClone(record.state));
	}

	async start(identity: ModelDownloadIdentity): Promise<ModelDownload> {
		if (this.#disposed) throw new Error("Model downloads are unavailable while shutting down.");
		const key = keyFor(identity);
		const current = this.#records.get(key);
		if (
			current &&
			(current.state.status === "downloading" || current.state.status === "cancelling")
		) {
			return structuredClone(current.state);
		}

		const artifact = await this.#options.resolveArtifact(identity);
		if (this.#disposed) throw new Error("Model downloads are unavailable while shutting down.");
		const afterResolve = this.#records.get(key);
		if (
			afterResolve &&
			(afterResolve.state.status === "downloading" || afterResolve.state.status === "cancelling")
		) {
			return structuredClone(afterResolve.state);
		}

		const record: DownloadRecord = {
			state: {
				modelId: artifact.modelId,
				quantizationId: artifact.quantizationId,
				status: "downloading",
				transferredBytes: 0,
				totalBytes: artifact.sizeBytes,
				percentage: 0,
			},
			controller: new AbortController(),
			artifact,
			cleanupPath: undefined,
			committing: false,
			task: undefined,
		};
		this.#records.set(key, record);
		this.#emit(record);
		record.task = this.#run(record);
		return structuredClone(record.state);
	}

	cancel(identity: ModelDownloadIdentity): ModelDownload {
		const record = this.#records.get(keyFor(identity));
		if (!record) throw new Error("No matching model download is active.");
		if (record.state.status !== "downloading" || record.committing) {
			return structuredClone(record.state);
		}
		record.state = { ...record.state, status: "cancelling" };
		this.#emit(record);
		record.controller.abort();
		return structuredClone(record.state);
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const record of this.#records.values()) {
			if (record.state.status !== "downloading" || record.committing) continue;
			record.state = { ...record.state, status: "cancelling" };
			record.controller.abort();
		}
		await Promise.allSettled(
			[...this.#records.values()].flatMap((record) => (record.task ? [record.task] : [])),
		);
	}

	async #run(record: DownloadRecord): Promise<void> {
		try {
			await this.#download(record);
		} catch (error) {
			await this.#removePartial(record);
			if (record.controller.signal.aborted || record.state.status === "cancelling") {
				record.state = { ...record.state, status: "cancelled" };
				this.#emit(record);
				return;
			}
			const message = failureMessage(error);
			this.#options.logger.error(
				`Catalog model download failed for ${record.artifact.modelId}/${record.artifact.quantizationId}: ${message}`,
			);
			record.state = { ...record.state, status: "failed", error: message };
			this.#emit(record);
		}
	}

	async #download(record: DownloadRecord): Promise<void> {
		const { artifact } = record;
		const { signal } = record.controller;
		await mkdir(this.#options.modelsDir, { recursive: true });
		const destination = destinationFor(this.#options.modelsDir, artifact);
		const partialPath = `${destination}.part`;
		record.cleanupPath = partialPath;

		if (await isCurrentArtifact(destination, artifact, signal)) {
			signal.throwIfAborted();
			record.committing = true;
			await this.#register(record, destination);
			this.#complete(record);
			return;
		}

		await Promise.all([rm(destination, { force: true }), rm(partialPath, { force: true })]);
		signal.throwIfAborted();
		const downloadUrl = await this.#options.resolveDownloadUrl(artifact, signal);
		signal.throwIfAborted();
		let response: Response;
		try {
			response = await this.#options.fetch(downloadUrl, { redirect: "follow", signal });
		} catch (error) {
			if (signal.aborted) throw error;
			throw new DownloadFailure("The model download was interrupted.", error);
		}
		if (!response.ok || !response.body) {
			throw new DownloadFailure("The model file could not be downloaded.");
		}

		let transferredBytes = 0;
		const hash = createHash("sha256");
		const source = Readable.from(
			trackDownload(response.body, signal, artifact.sizeBytes, hash, (chunkBytes) => {
				transferredBytes += chunkBytes;
				this.#progress(record, transferredBytes);
			}),
		);
		await pipeline(source, createWriteStream(partialPath), { signal });

		if (transferredBytes !== artifact.sizeBytes || hash.digest("hex") !== artifact.sha256) {
			throw new DownloadFailure("The downloaded model failed its integrity check.");
		}
		if (!(await hasGgufHeader(partialPath))) {
			throw new DownloadFailure("The downloaded file is not a valid GGUF model.");
		}
		signal.throwIfAborted();
		record.committing = true;
		await rename(partialPath, destination);
		record.cleanupPath = destination;
		await this.#register(record, destination);
		record.cleanupPath = undefined;
		this.#complete(record);
	}

	async #register(record: DownloadRecord, destination: string): Promise<void> {
		const { artifact } = record;
		await this.#options.addModel({
			path: destination,
			name: `${artifact.modelName} (${artifact.quantization})`,
			catalog: {
				modelId: artifact.modelId,
				quantizationId: artifact.quantizationId,
				publisher: artifact.publisher,
			},
			managedFile: true,
			sizeBytes: artifact.sizeBytes,
		});
	}

	#progress(record: DownloadRecord, transferredBytes: number): void {
		const boundedBytes = Math.min(transferredBytes, record.state.totalBytes);
		const percentage = Math.min(99, Math.floor((boundedBytes / record.state.totalBytes) * 100));
		const changed = percentage !== record.state.percentage;
		record.state = { ...record.state, transferredBytes: boundedBytes, percentage };
		if (changed) this.#emit(record);
	}

	#complete(record: DownloadRecord): void {
		record.state = {
			...record.state,
			status: "completed",
			transferredBytes: record.state.totalBytes,
			percentage: 100,
		};
		this.#emit(record);
	}

	async #removePartial(record: DownloadRecord): Promise<void> {
		if (!record.cleanupPath) return;
		try {
			await rm(record.cleanupPath, { force: true });
		} catch (error) {
			this.#options.logger.warn(
				`Could not clean up model download for ${record.artifact.modelId}.`,
				error,
			);
		}
		record.cleanupPath = undefined;
	}

	#emit(record: DownloadRecord): void {
		this.#options.emit(structuredClone(record.state));
	}
}

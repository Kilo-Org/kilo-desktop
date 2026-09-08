import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { execa } from "execa";

import type { LocalInferenceStatus, LocalModel } from "../contracts/schemas.js";
import { renderModelPreset } from "../shared/provider-config.js";
import {
	compactServerSettings,
	renderRouterArgs,
	type LocalServerSettings,
} from "../shared/server-settings.js";

export type LlamaRouterStatus = LocalInferenceStatus;

export interface LlamaRouterConnection {
	readonly baseUrl: string;
	readonly port: number;
}

export interface LlamaChildProcess {
	readonly pid?: number;
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	readonly exitCode: number | null;
	kill(signal?: NodeJS.Signals | number): boolean;
	on: EventEmitter["on"];
	once: EventEmitter["once"];
	off: EventEmitter["off"];
}

interface RouterLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface LlamaRouterManagerOptions {
	readonly storageDir: string;
	readonly apiKey?: string;
	readonly resolveExecutable: () => Promise<string>;
	readonly allocatePort: () => Promise<number>;
	readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	readonly spawn?: (
		executable: string,
		args: readonly string[],
		options: { cwd: string; detached: boolean; env: NodeJS.ProcessEnv },
	) => LlamaChildProcess;
	readonly queryVersion?: (executable: string) => Promise<string>;
	readonly reclaimStaleRouters?: (presetPath: string) => Promise<void>;
	readonly logger: RouterLogger;
	readonly onStatusChange?: (status: LlamaRouterStatus) => void;
	readonly healthTimeoutMs?: number;
	readonly healthRetryDelayMs?: number;
	readonly modelLoadTimeoutMs?: number;
	readonly stopTimeoutMs?: number;
}

function defaultSpawn(
	executable: string,
	args: readonly string[],
	options: { cwd: string; detached: boolean; env: NodeJS.ProcessEnv },
): LlamaChildProcess {
	return execa(executable, args, {
		...options,
		buffer: false,
		reject: false,
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
	}) as unknown as LlamaChildProcess;
}

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function routerKey(preset: string, settings: LocalServerSettings): string {
	return `${preset}\0${JSON.stringify(compactServerSettings(settings) ?? {})}`;
}

function available(models: readonly LocalModel[]): LocalModel[] {
	return models.filter((model) => model.available);
}

function publicError(): LlamaRouterStatus {
	return {
		status: "error",
		message: "Local inference could not start. Check the model files and try again.",
	};
}

function isCancelled(error: unknown): boolean {
	return error instanceof Error && /Local inference .* was cancelled\./.test(error.message);
}

function loadCancelled(): Error {
	return new Error("Local inference model load was cancelled.");
}

function isPidAlive(pid: number | undefined): boolean {
	if (pid === undefined || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

function listenOutput(child: LlamaChildProcess, logger: RouterLogger): void {
	const attach = (stream: Readable | null) => {
		if (!stream) return;
		const lines = createInterface({ input: stream });
		lines.on("line", (line) => {
			const text = line.trim();
			if (!text) return;
			if (/\b(error|fatal|fail|panic)/i.test(text)) {
				logger.error(`llama-server: ${text}`);
			}
		});
	};
	attach(child.stdout);
	attach(child.stderr);
}

function defaultQueryVersion(executable: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			executable,
			["--version"],
			{ timeout: 5_000, windowsHide: true },
			(error, _stdout, stderr) => {
				if (error) return reject(error);
				const output = (stderr || _stdout).trim();
				const first = output.split("\n").find((line) => line.trim().length > 0);
				resolve(first?.trim() ?? "unknown");
			},
		);
	});
}

function listPresetPids(presetPath: string): Promise<number[]> {
	if (process.platform === "win32") return Promise.resolve([]);
	return new Promise((resolve) => {
		execFile("pgrep", ["-f", presetPath], { windowsHide: true }, (error, stdout) => {
			if (error || !stdout.trim()) {
				resolve([]);
				return;
			}
			resolve(
				stdout
					.split("\n")
					.map((line) => Number.parseInt(line.trim(), 10))
					.filter((pid) => Number.isInteger(pid) && pid > 0),
			);
		});
	});
}

function processName(pid: number): Promise<string> {
	return new Promise((resolve) => {
		execFile("ps", ["-p", String(pid), "-o", "comm="], { windowsHide: true }, (error, stdout) => {
			resolve(error ? "" : stdout.trim());
		});
	});
}

async function reclaimStaleRouters(presetPath: string, logger: RouterLogger): Promise<void> {
	const pids = await listPresetPids(presetPath);
	for (const pid of pids) {
		const name = await processName(pid);
		if (!name.endsWith("llama-server")) continue;
		logger.warn(`Stopping leftover llama-server (pid ${String(pid)}).`);
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				logger.warn(`Could not stop leftover llama-server (pid ${String(pid)}).`);
			}
		}
	}
}

function startupInterrupted(cancelled: boolean): Error {
	if (cancelled) return new Error("Local inference startup was cancelled.");
	return new Error("llama-server exited before becoming healthy.");
}

function killProcess(child: LlamaChildProcess, signal: NodeJS.Signals): void {
	const pid = child.pid;
	if (!pid) {
		child.kill(signal);
		return;
	}
	if (process.platform === "win32") {
		if (signal === "SIGKILL") {
			execFile(
				"taskkill",
				["/pid", String(pid), "/T", "/F"],
				{ windowsHide: true },
				() => undefined,
			);
			return;
		}
		child.kill(signal);
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch {
		child.kill(signal);
	}
}

function waitForExit(child: LlamaChildProcess, timeoutMs: number): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.off("exit", onExit);
			resolve();
		};
		const onExit = () => {
			if (isPidAlive(child.pid)) return;
			finish();
		};
		const timer = setTimeout(() => {
			killProcess(child, "SIGKILL");
			child.kill("SIGKILL");
			finish();
		}, timeoutMs);
		child.on("exit", onExit);
		killProcess(child, "SIGKILL");
		child.kill("SIGKILL");
	});
}

/**
 * Owns exactly one llama.cpp router process for every registered GGUF.
 * `--models-max` defaults to one and expands to the registry size only when
 * the user explicitly enables all-model residency. Loads are serialized and
 * coalesced, while residency is synchronized
 * from llama.cpp's model list after every load because the router may evict
 * an older model at its configured limit. Each load belongs to one router
 * generation so a stopped router cannot update the replacement's state. The
 * child is detached so model workers share its process group; stdio stays
 * piped so Electron does not drop the process handle. Stop publishes
 * `stopping` and waits for the group to exit (bounded by a force-kill timeout)
 * so Start cannot spawn a second router while the first is still dying.
 */
export class LlamaRouterManager {
	readonly #options: Required<
		Pick<
			LlamaRouterManagerOptions,
			| "spawn"
			| "onStatusChange"
			| "healthTimeoutMs"
			| "healthRetryDelayMs"
			| "modelLoadTimeoutMs"
			| "stopTimeoutMs"
			| "apiKey"
			| "reclaimStaleRouters"
		>
	> &
		Omit<
			LlamaRouterManagerOptions,
			| "spawn"
			| "onStatusChange"
			| "healthTimeoutMs"
			| "healthRetryDelayMs"
			| "modelLoadTimeoutMs"
			| "stopTimeoutMs"
			| "apiKey"
			| "reclaimStaleRouters"
		>;
	readonly #intentional = new WeakSet<LlamaChildProcess>();
	readonly #loads = new Map<string, Promise<void>>();
	readonly #loaded = new Set<string>();
	#status: LlamaRouterStatus = { status: "idle" };
	#child: LlamaChildProcess | undefined;
	#connection: LlamaRouterConnection | undefined;
	#start: Promise<LlamaRouterConnection | null> | undefined;
	#loadTail: Promise<void> = Promise.resolve();
	#key = "";
	#settings: LocalServerSettings = {};
	#generation = 0;
	#executable: string | undefined;
	#disposed = false;

	constructor(options: LlamaRouterManagerOptions) {
		this.#options = {
			...options,
			apiKey: options.apiKey ?? randomBytes(24).toString("base64url"),
			spawn: options.spawn ?? defaultSpawn,
			onStatusChange: options.onStatusChange ?? (() => {}),
			healthTimeoutMs: options.healthTimeoutMs ?? 60_000,
			healthRetryDelayMs: options.healthRetryDelayMs ?? 250,
			modelLoadTimeoutMs: options.modelLoadTimeoutMs ?? 300_000,
			stopTimeoutMs: options.stopTimeoutMs ?? 5_000,
			reclaimStaleRouters:
				options.reclaimStaleRouters ??
				((presetPath) => reclaimStaleRouters(presetPath, options.logger)),
		};
	}

	get status(): LlamaRouterStatus {
		return structuredClone(this.#status);
	}

	get apiKey(): string {
		return this.#options.apiKey;
	}

	async ensureRunning(
		models: readonly LocalModel[],
		settings: LocalServerSettings = this.#settings,
	): Promise<LlamaRouterConnection | null> {
		if (this.#disposed) throw new Error("Local inference has been disposed.");
		this.#settings = settings;
		const nextPreset = renderModelPreset(models);
		if (!nextPreset) {
			const inflight = this.#start;
			await this.#stop();
			if (inflight) await inflight.catch(() => undefined);
			this.#setStatus({ status: "idle" });
			return null;
		}
		const nextKey = routerKey(nextPreset, settings);
		if (this.#connection && this.#key === nextKey) return this.#connection;
		if (this.#start && this.#key === nextKey) return this.#start;
		if (this.#child || this.#start) await this.#stop();

		this.#key = nextKey;
		const start = this.#startRouter(models, nextPreset, settings);
		this.#start = start;
		return start.finally(() => {
			if (this.#start === start) this.#start = undefined;
		});
	}

	async prepareModel(modelId: string, models: readonly LocalModel[]): Promise<void> {
		const model = available(models).find((candidate) => candidate.id === modelId);
		if (!model) throw new Error("The selected local model is unavailable.");
		if (this.#loaded.has(modelId)) return;
		const existing = this.#loads.get(modelId);
		if (existing) return existing;
		const load = this.#loadTail.then(() => this.#load(modelId, models));
		this.#loads.set(modelId, load);
		const tracked = load.finally(() => {
			if (this.#loads.get(modelId) === load) this.#loads.delete(modelId);
		});
		this.#loadTail = tracked.catch(() => undefined);
		return tracked;
	}

	async restart(
		models: readonly LocalModel[],
		settings: LocalServerSettings = this.#settings,
	): Promise<LlamaRouterConnection | null> {
		await this.#stop();
		return this.ensureRunning(models, settings);
	}

	dispose(): void {
		this.#disposed = true;
		this.#generation += 1;
		const child = this.#child;
		this.#child = undefined;
		this.#connection = undefined;
		this.#start = undefined;
		this.#loads.clear();
		this.#loaded.clear();
		this.#loadTail = Promise.resolve();
		if (child) {
			this.#intentional.add(child);
			killProcess(child, "SIGKILL");
			child.kill("SIGKILL");
		}
		this.#setStatus({ status: "idle" });
	}

	async #startRouter(
		models: readonly LocalModel[],
		preset: string,
		settings: LocalServerSettings,
	): Promise<LlamaRouterConnection> {
		const generation = this.#generation;
		let child: LlamaChildProcess | undefined;
		try {
			const executable = await this.#executablePath();
			if (this.#disposed || this.#generation !== generation) {
				throw new Error("Local inference startup was cancelled.");
			}
			this.#options.logger.info(`llama-server executable: ${executable}`);
			try {
				const queryVersion = this.#options.queryVersion ?? defaultQueryVersion;
				const version = await queryVersion(executable);
				this.#options.logger.info(`llama-server version: ${version}`);
			} catch {
				this.#options.logger.warn("llama-server: could not determine version.");
			}
			this.#setStatus({ status: "starting" });
			const runtime = path.join(this.#options.storageDir, "runtime");
			await mkdir(runtime, { recursive: true });
			const presetPath = path.join(runtime, "models.ini");
			const temporaryPath = `${presetPath}.${crypto.randomUUID()}.tmp`;
			await writeFile(temporaryPath, preset, "utf8");
			await rename(temporaryPath, presetPath);
			await this.#options.reclaimStaleRouters(presetPath);
			const port = await this.#options.allocatePort();
			if (this.#disposed || this.#generation !== generation) {
				throw new Error("Local inference startup was cancelled.");
			}
			const args = renderRouterArgs({
				port,
				apiKey: this.#options.apiKey,
				presetPath,
				modelCount: available(models).length,
				settings,
			});
			const spawned = this.#options.spawn(executable, args, {
				cwd: runtime,
				detached: true,
				env: process.env,
			});
			child = spawned;
			if (this.#disposed || this.#generation !== generation) {
				this.#intentional.add(spawned);
				killProcess(spawned, "SIGKILL");
				throw new Error("Local inference startup was cancelled.");
			}
			this.#child = spawned;
			listenOutput(spawned, this.#options.logger);
			const onExit = (code: unknown) => {
				if (this.#intentional.has(spawned) || this.#disposed) return;
				if (isPidAlive(spawned.pid)) {
					this.#options.logger.warn("llama-server reported exit but the process is still running.");
					return;
				}
				spawned.off("exit", onExit);
				if (this.#child === spawned) {
					this.#child = undefined;
					this.#connection = undefined;
					this.#loaded.clear();
					this.#setStatus(publicError());
				}
				this.#options.logger.error(`llama-server exited unexpectedly with code ${String(code)}.`);
			};
			spawned.on("exit", onExit);
			const connection = { baseUrl: `http://127.0.0.1:${String(port)}`, port };
			await this.#waitForHealth(spawned, connection);
			if (this.#disposed || this.#generation !== generation) {
				throw new Error("Local inference startup was cancelled.");
			}
			if (this.#child !== spawned) {
				throw startupInterrupted(this.#intentional.has(spawned));
			}
			this.#connection = connection;
			this.#setStatus(this.#ready());
			this.#options.logger.info(
				`llama-server router ready with ${String(available(models).length)} model(s).`,
			);
			return connection;
		} catch (error) {
			if (this.#generation === generation) {
				await this.#stop();
			} else if (child) {
				this.#intentional.add(child);
				killProcess(child, "SIGKILL");
			}
			if (this.#disposed) {
				this.#setStatus({ status: "idle" });
				throw error;
			}
			if (isCancelled(error)) throw error;
			this.#setStatus(publicError());
			this.#options.logger.error(
				`llama-server startup failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	}

	async #load(modelId: string, models: readonly LocalModel[]): Promise<void> {
		const connection = await this.ensureRunning(models);
		if (!connection) throw new Error("No local models are available.");
		const generation = this.#generation;
		this.#assertActiveLoad(generation, connection);
		this.#setStatus({
			status: "loading-model",
			modelId,
			loadedModelIds: [...this.#loaded],
		});
		try {
			const response = await this.#options.fetch(`${connection.baseUrl}/models/load`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.#options.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ model: modelId }),
			});
			this.#assertActiveLoad(generation, connection);
			if (!response.ok) {
				throw new Error(`llama-server rejected model load with HTTP ${String(response.status)}.`);
			}
			const loadedModelIds = await this.#waitForModel(connection, modelId, generation);
			this.#assertActiveLoad(generation, connection);
			this.#loaded.clear();
			for (const loadedModelId of loadedModelIds) this.#loaded.add(loadedModelId);
			this.#setStatus(this.#ready(modelId));
		} catch (error) {
			if (isCancelled(error)) throw error;
			if (!this.#disposed && this.#generation === generation && this.#connection === connection) {
				this.#setStatus(publicError());
			}
			throw error;
		}
	}

	async #waitForHealth(child: LlamaChildProcess, connection: LlamaRouterConnection): Promise<void> {
		const deadline = Date.now() + this.#options.healthTimeoutMs;
		while (Date.now() < deadline) {
			try {
				const response = await this.#options.fetch(`${connection.baseUrl}/health`, {
					headers: { Authorization: `Bearer ${this.#options.apiKey}` },
				});
				if (response.ok) return;
			} catch {
				// The process can bind after the first few probes.
			}
			if (child.exitCode !== null || this.#child !== child) {
				if (isPidAlive(child.pid)) {
					await delay(this.#options.healthRetryDelayMs);
					continue;
				}
				throw startupInterrupted(this.#intentional.has(child) || this.#disposed);
			}
			await delay(this.#options.healthRetryDelayMs);
		}
		throw new Error("llama-server did not become healthy in time.");
	}

	async #waitForModel(
		connection: LlamaRouterConnection,
		modelId: string,
		generation: number,
	): Promise<string[]> {
		const deadline = Date.now() + this.#options.modelLoadTimeoutMs;
		while (Date.now() < deadline) {
			this.#assertActiveLoad(generation, connection);
			try {
				const response = await this.#options.fetch(`${connection.baseUrl}/models`, {
					headers: { Authorization: `Bearer ${this.#options.apiKey}` },
				});
				this.#assertActiveLoad(generation, connection);
				if (response.ok) {
					const loadedModelIds = parseLoadedModelIds(await response.json());
					this.#assertActiveLoad(generation, connection);
					if (loadedModelIds.includes(modelId)) return loadedModelIds;
				}
			} catch (error) {
				if (isCancelled(error)) throw error;
				// Model child startup can briefly reset the router connection.
			}
			await delay(this.#options.healthRetryDelayMs);
		}
		this.#assertActiveLoad(generation, connection);
		throw new Error(`llama-server did not finish loading model "${modelId}" in time.`);
	}

	#assertActiveLoad(generation: number, connection: LlamaRouterConnection): void {
		if (this.#disposed || this.#generation !== generation || this.#connection !== connection) {
			throw loadCancelled();
		}
	}

	async #executablePath(): Promise<string> {
		if (this.#executable) return this.#executable;
		this.#setStatus({ status: "preparing-runtime" });
		const executable = await this.#options.resolveExecutable();
		this.#executable = executable;
		return executable;
	}

	async #stop(): Promise<void> {
		this.#generation += 1;
		const child = this.#child;
		this.#child = undefined;
		this.#connection = undefined;
		this.#start = undefined;
		this.#loads.clear();
		this.#loaded.clear();
		this.#loadTail = Promise.resolve();
		if (!child) return;
		this.#intentional.add(child);
		this.#setStatus({ status: "stopping" });
		await waitForExit(child, this.#options.stopTimeoutMs);
	}

	#setStatus(status: LlamaRouterStatus): void {
		this.#status = status;
		this.#options.onStatusChange(structuredClone(status));
	}

	#ready(loadedModelId?: string): LlamaRouterStatus {
		const loadedModelIds = [...this.#loaded];
		if (loadedModelId) {
			return { status: "ready", loadedModelId, loadedModelIds };
		}
		return { status: "ready", loadedModelIds };
	}
}

function parseLoadedModelIds(payload: unknown): string[] {
	if (!payload || typeof payload !== "object" || !("data" in payload)) return [];
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];
	return data.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const model = entry as { id?: unknown; status?: unknown };
		if (typeof model.id !== "string") return [];
		if (model.status === "loaded") return [model.id];
		if (!model.status || typeof model.status !== "object") return [];
		return (model.status as { value?: unknown }).value === "loaded" ? [model.id] : [];
	});
}

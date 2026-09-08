import { lstat, realpath, rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { LocalInferenceStatus, LocalModel } from "../contracts/schemas.js";
import type { LocalModelSettings } from "../shared/model-settings.js";
import {
	advertisedListenHost,
	localConnectionInfo,
	type NetworkAddress,
} from "../shared/connection-info.js";
import {
	compactServerSettings,
	proxyBindHost,
	type LocalServerSettings,
} from "../shared/server-settings.js";
import {
	LLAMA_API_KEY_ENV,
	LOCAL_PROVIDER_ID,
	LOCAL_PROVIDER_SOURCE_ID,
	MODELS_CHANGED_EVENT,
	STATUS_CHANGED_EVENT,
} from "../shared/constants.js";
import { createProviderEntry } from "../shared/provider-config.js";
import type { LlamaRouterConnection, LlamaRouterStatus } from "./LlamaRouterManager.js";
import type { LocalModelRegistry } from "./LocalModelRegistry.js";

export interface KiloCapability extends Record<string, unknown> {
	kiloService: {
		serverEnv: {
			contribute(sourceId: string, env: Record<string, string>): () => void;
		};
		providerConfig: {
			set(
				sourceId: string,
				providerId: string,
				entry: Readonly<Record<string, unknown>>,
			): Promise<void>;
			remove(sourceId: string, providerId: string): Promise<void>;
		};
	};
}

export interface LocalInferenceServiceOptions {
	readonly registry: LocalModelRegistry;
	readonly managedModelsDir?: string;
	readonly router: {
		readonly apiKey: string;
		readonly status: LlamaRouterStatus;
		ensureRunning(
			models: readonly LocalModel[],
			settings?: LocalServerSettings,
		): Promise<LlamaRouterConnection | null>;
		restart(
			models: readonly LocalModel[],
			settings?: LocalServerSettings,
		): Promise<LlamaRouterConnection | null>;
		prepareModel(modelId: string, models: readonly LocalModel[]): Promise<void>;
		dispose(): void;
	};
	readonly proxy: {
		readonly port?: number | undefined;
		ensureListening(port?: number, host?: string): Promise<LlamaRouterConnection>;
		ensureRunning(upstream: string, port?: number, host?: string): Promise<LlamaRouterConnection>;
		close(): void;
	};
	readonly networkInterfaces?: () => Readonly<
		Record<string, readonly NetworkAddress[] | undefined>
	>;
	readonly getKilo: () => KiloCapability | null;
	readonly emit: (event: string, payload: unknown) => void;
	readonly logger: MainSdkLogger;
}

export type LocalModelRemovalMode = "registry-only" | "delete-managed-file";

function isWithinDirectory(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function deleteManagedModelFile(model: LocalModel, modelsDir: string): Promise<void> {
	if (!model.managedFile) {
		throw new Error("Only models downloaded from the catalog can be deleted by the app.");
	}
	if (path.extname(model.path).toLowerCase() !== ".gguf") {
		throw new Error("The managed model path is not a GGUF file.");
	}
	const managedRoot = await realpath(modelsDir);
	const candidate = path.resolve(model.path);
	if (!isWithinDirectory(managedRoot, candidate)) {
		throw new Error("The managed model path is outside the local models folder.");
	}
	try {
		const details = await lstat(candidate);
		if (details.isSymbolicLink()) {
			throw new Error("Symbolic links cannot be deleted as managed models.");
		}
		const canonicalCandidate = await realpath(candidate);
		if (!isWithinDirectory(managedRoot, canonicalCandidate)) {
			throw new Error("The managed model path is outside the local models folder.");
		}
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	await rm(candidate, { force: true });
}

/**
 * Reconciles three pieces of state behind one small interface: the persisted
 * GGUF registry, the single llama.cpp router, and Kilo's managed Local provider.
 *
 * Provider registration is fast and happens before llama-server is ready so
 * Kilo's first spawn already sees `anaconda-local`. Starting the router and
 * loading GGUF weights stay in the background until the first prompt.
 * Disconnect keeps registered GGUF files but unpublishes the provider and
 * stops the router until Start. Status is `stopping` while the process
 * exits, then `disconnected`. Launching with any registered models, or
 * adding a model, starts the server again. Server settings (port, model residency,
 * extra llama.cpp router flags, LAN serving) persist independently and restart
 * the public proxy when they change. llama.cpp stays on loopback. Router,
 * provider, and managed-file removal transitions share one operation queue so
 * a reconcile cannot reopen a model while its file is being deleted.
 */
export class LocalInferenceService {
	readonly #options: LocalInferenceServiceOptions;
	#pending: Promise<void> = Promise.resolve();
	#envDispose: (() => void) | undefined;
	#error: string | undefined;
	#disposed = false;

	constructor(options: LocalInferenceServiceOptions) {
		this.#options = options;
	}

	list(): LocalModel[] {
		return this.#options.registry.list();
	}

	get status(): LocalInferenceStatus {
		if (this.#error) return { status: "error", message: this.#error };
		if (!this.#options.registry.isEnabled()) {
			if (isRouterStillRunning(this.#options.router.status)) {
				return { status: "stopping" };
			}
			return { status: "disconnected" };
		}
		const status = this.#options.router.status;
		if (status.status !== "ready") return status;
		const port = this.#options.proxy.port;
		if (port === undefined) return status;
		return {
			...status,
			connection: localConnectionInfo(port, this.#options.router.apiKey, this.#advertisedHost()),
		};
	}

	async initialize(): Promise<void> {
		await this.#options.registry.refresh();
		this.#emitModels();
		if (this.list().length > 0) {
			this.#options.registry.setEnabled(true);
		}
		if (this.#options.registry.isEnabled()) {
			await this.#run(() => this.#publishProvider());
		}
		this.#reconcileInBackground();
	}

	async add(input: {
		path: string;
		name?: string | undefined;
		catalog?: LocalModel["catalog"];
		managedFile?: boolean;
		sizeBytes?: number;
	}): Promise<LocalModel> {
		const model = await this.#options.registry.add(input.path, input.name, input.catalog, {
			...(input.managedFile === undefined ? {} : { managedFile: input.managedFile }),
			...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
		});
		this.#options.registry.setEnabled(true);
		this.#emitModels();
		this.#reconcileInBackground();
		return model;
	}

	async remove(id: string, mode: LocalModelRemovalMode): Promise<boolean> {
		let removed = false;
		let removalFailure: { error: unknown } | undefined;
		await this.#run(async () => {
			const model = this.list().find((entry) => entry.id === id);
			if (!model) return;
			if (mode === "delete-managed-file") {
				const managedModelsDir = this.#options.managedModelsDir;
				if (!managedModelsDir) {
					removalFailure = { error: new Error("Managed model deletion is unavailable.") };
					return;
				}
				await this.#releaseModelFile(model.id);
				try {
					await deleteManagedModelFile(model, managedModelsDir);
				} catch (error) {
					removalFailure = { error };
					await this.#reconcileAfterMutation(true);
					return;
				}
			}
			removed = this.#options.registry.remove(id);
			if (!removed) return;
			this.#emitModels();
			await this.#reconcileAfterMutation();
		});
		if (removalFailure) throw removalFailure.error;
		return removed;
	}

	async #releaseModelFile(modelId: string): Promise<void> {
		if (this.#disposed || !isRouterStillRunning(this.#options.router.status)) return;
		const remaining = this.list().filter((model) => model.id !== modelId && model.available);
		const settings = this.serverSettings();
		const routerSettings = compactServerSettings({
			modelLoadMode: settings.modelLoadMode,
			llamaFlags: settings.llamaFlags,
		});
		const connection = await this.#options.router.ensureRunning(remaining, routerSettings ?? {});
		if (!connection) return;
		await this.#options.proxy.ensureRunning(
			connection.baseUrl,
			settings.port,
			proxyBindHost(settings.serveOnLocalNetwork),
		);
	}

	update(id: string, settings: LocalModelSettings): LocalModel {
		const model = this.#options.registry.update(id, settings);
		if (!model) throw new Error("Local model not found.");
		this.#emitModels();
		this.#reconcileInBackground();
		return model;
	}

	serverSettings(): LocalServerSettings {
		return this.#options.registry.serverSettings();
	}

	updateServerSettings(settings: LocalServerSettings): LocalServerSettings {
		const next = this.#options.registry.setServerSettings(settings);
		this.#reconcileInBackground();
		return next;
	}

	async prepareModel(modelId: string): Promise<void> {
		if (!this.#options.registry.isEnabled()) {
			throw new Error("Local inference is disconnected.");
		}
		if (this.#options.router.status.status !== "ready") {
			await this.reconcile();
		}
		await this.#options.router.prepareModel(modelId, this.list());
	}

	#run(operation: () => Promise<void>): Promise<void> {
		const result = this.#pending.then(operation, operation);
		this.#pending = result.catch((error) => this.#recordReconcileFailure(error));
		return result;
	}

	#recordReconcileFailure(error: unknown): void {
		this.#options.logger.error(
			`Local inference reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		if (this.#options.router.status.status === "error") {
			this.#error = undefined;
		} else {
			this.#error = "Local inference could not be configured. Check the app logs and try again.";
		}
		this.#options.emit(STATUS_CHANGED_EVENT, this.status);
	}

	#reconcileInBackground(forceRestart = false): void {
		void this.reconcile(forceRestart).catch(() => undefined);
	}

	async #reconcileAfterMutation(forceRestart = false): Promise<void> {
		try {
			await this.#reconcileState(forceRestart);
		} catch (error) {
			this.#recordReconcileFailure(error);
		}
	}

	async #publishProvider(): Promise<void> {
		if (this.#disposed) return;
		const available = this.list().filter((model) => model.available);
		const kilo = this.#options.getKilo();
		if (kilo && !this.#envDispose) {
			this.#envDispose = kilo.kiloService.serverEnv.contribute(LOCAL_PROVIDER_SOURCE_ID, {
				[LLAMA_API_KEY_ENV]: this.#options.router.apiKey,
			});
		}
		if (available.length === 0) {
			this.#options.proxy.close();
			await this.#removeProvider();
			return;
		}
		const settings = this.serverSettings();
		const proxy = await this.#options.proxy.ensureListening(
			settings.port,
			proxyBindHost(settings.serveOnLocalNetwork),
		);
		if (!kilo) return;
		await kilo.kiloService.providerConfig.set(
			LOCAL_PROVIDER_SOURCE_ID,
			LOCAL_PROVIDER_ID,
			createProviderEntry(available, `${proxy.baseUrl}/v1`),
		);
	}

	retry(): void {
		this.#reconcileInBackground(true);
	}

	async disconnect(): Promise<void> {
		this.#options.registry.setEnabled(false);
		this.#error = undefined;
		this.#options.emit(STATUS_CHANGED_EVENT, this.status);
		await this.reconcile();
	}

	async connect(): Promise<void> {
		this.#options.registry.setEnabled(true);
		await this.reconcile();
	}

	reconcile(forceRestart = false): Promise<void> {
		return this.#run(() => this.#reconcileState(forceRestart));
	}

	async #reconcileState(forceRestart = false): Promise<void> {
		if (this.#disposed) return;
		if (!this.#options.registry.isEnabled()) {
			await this.#unpublish();
			this.#error = undefined;
			this.#emitModels();
			this.#options.emit(STATUS_CHANGED_EVENT, this.status);
			return;
		}
		await this.#publishProvider();
		const available = this.list().filter((model) => model.available);
		if (available.length === 0) {
			await this.#options.router.ensureRunning([]);
			this.#error = undefined;
			this.#emitModels();
			return;
		}
		const settings = this.serverSettings();
		const routerSettings = compactServerSettings({
			modelLoadMode: settings.modelLoadMode,
			llamaFlags: settings.llamaFlags,
		});
		const connection = forceRestart
			? await this.#options.router.restart(available, routerSettings ?? {})
			: await this.#options.router.ensureRunning(available, routerSettings ?? {});
		if (!connection) return;
		await this.#options.proxy.ensureRunning(
			connection.baseUrl,
			settings.port,
			proxyBindHost(settings.serveOnLocalNetwork),
		);
		this.#error = undefined;
		this.#emitModels();
	}

	dispose(): void {
		this.#disposed = true;
		this.#envDispose?.();
		this.#envDispose = undefined;
		this.#options.router.dispose();
		this.#options.proxy.close();
	}

	async #removeProvider(): Promise<void> {
		const kilo = this.#options.getKilo();
		await kilo?.kiloService.providerConfig.remove(LOCAL_PROVIDER_SOURCE_ID, LOCAL_PROVIDER_ID);
	}

	async #unpublish(): Promise<void> {
		this.#options.proxy.close();
		await this.#options.router.ensureRunning([]);
		await this.#removeProvider();
	}

	#emitModels(): void {
		this.#options.emit(MODELS_CHANGED_EVENT, {
			modelIds: this.list().map((model) => model.id),
		});
	}

	#advertisedHost(): string {
		const lan = Boolean(this.serverSettings().serveOnLocalNetwork);
		return advertisedListenHost(lan, lan ? this.#networkInterfaces() : {});
	}

	#networkInterfaces(): Readonly<Record<string, readonly NetworkAddress[] | undefined>> {
		if (this.#options.networkInterfaces) return this.#options.networkInterfaces();
		try {
			return networkInterfaces();
		} catch {
			return {};
		}
	}
}

function isRouterStillRunning(status: LlamaRouterStatus): boolean {
	switch (status.status) {
		case "preparing-runtime":
		case "starting":
		case "ready":
		case "loading-model":
		case "stopping":
			return true;
		case "idle":
		case "error":
		case "disconnected":
			return false;
		default: {
			const exhaustive: never = status;
			return exhaustive;
		}
	}
}

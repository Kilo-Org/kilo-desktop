import { networkInterfaces } from "node:os";

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
 * adding a model, starts the server again. Server settings (port, max models,
 * extra llama.cpp router flags, LAN serving) persist independently and restart
 * the public proxy when they change. llama.cpp stays on loopback.
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
		if (!this.#options.registry.isEnabled() && this.list().length > 0) {
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
		void this.reconcile();
	}

	async add(input: { path: string; name?: string | undefined }): Promise<LocalModel> {
		const model = await this.#options.registry.add(input.path, input.name);
		this.#options.registry.setEnabled(true);
		this.#emitModels();
		void this.reconcile();
		return model;
	}

	remove(id: string): boolean {
		const removed = this.#options.registry.remove(id);
		if (!removed) return false;
		this.#emitModels();
		void this.reconcile();
		return true;
	}

	update(id: string, settings: LocalModelSettings): LocalModel {
		const model = this.#options.registry.update(id, settings);
		if (!model) throw new Error("Local model not found.");
		this.#emitModels();
		void this.reconcile();
		return model;
	}

	serverSettings(): LocalServerSettings {
		return this.#options.registry.serverSettings();
	}

	updateServerSettings(settings: LocalServerSettings): LocalServerSettings {
		const next = this.#options.registry.setServerSettings(settings);
		void this.reconcile();
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
		this.#pending = result.catch((error) => {
			this.#options.logger.error(
				`Local inference reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			if (this.#options.router.status.status === "error") {
				this.#error = undefined;
			} else {
				this.#error = "Local inference could not be configured. Check the app logs and try again.";
			}
			this.#options.emit(STATUS_CHANGED_EVENT, this.status);
		});
		return result;
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
		void this.reconcile(true);
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
		return this.#run(async () => {
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
				maxModels: settings.maxModels,
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
		});
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

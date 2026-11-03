import { KernelError } from "./errors";
import type { PluginSdk } from "./sdk";

/**
 * Per-plugin services the main-process host injects into `sdk.host`. They are
 * scoped to the calling plugin (its own storage directory, kv namespace and
 * file sandbox). `protocol`, `browser` and `embeddedHosts` are present only
 * when the plugin's manifest declares the matching permission.
 */
export interface KvStore<T extends Record<string, unknown>> {
	snapshot(): T;
	get<K extends keyof T>(key: K): T[K];
	set(patch: Partial<T>): T;
	clear(): void;
}

export interface KvStoreOptions<T extends Record<string, unknown>> {
	readonly defaults: T;
	readonly namespace?: string;
}

export interface PluginStorage {
	/** This plugin's private storage directory. */
	readonly dir: string;
	kv<T extends Record<string, unknown>>(options: KvStoreOptions<T>): KvStore<T>;
}

/** File access confined to this plugin's sandbox; paths are relative. */
export interface PluginFs {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	readdir(path: string): Promise<string[]>;
	remove(path: string): Promise<void>;
}

export interface PluginNet {
	readonly fetch: typeof globalThis.fetch;
}

/** Handles URL schemes declared in `permissions.protocols`. */
export interface PluginProtocol {
	handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): () => void;
}

/** An embedded web host declared in `permissions.embeddedHosts`; the host owns serving and CSP. */
export interface EmbeddedHostRegistration {
	readonly host: string;
	readonly root: string | undefined;
	readonly [option: string]: unknown;
}

export interface PluginEmbeddedHosts {
	register(registration: EmbeddedHostRegistration): () => void;
}

export interface MainHostServices {
	readonly storage: PluginStorage;
	readonly fs: PluginFs;
	readonly net: PluginNet;
	readonly protocol?: PluginProtocol;
	readonly embeddedHosts?: PluginEmbeddedHosts;
	/** The embedded browser host (`browser-host` permission); typed by its consumer. */
	readonly browser?: unknown;
	/** Files the plugin ships, e.g. bundled binaries; absent where the host has none. */
	readonly assets?: PluginAssets;
}

/**
 * Locates files a plugin ships in its `resources/` folder. The host maps the
 * folder to wherever the build put it (the plugin's folder in development,
 * the app's resources when packaged).
 */
export interface PluginAssets {
	/** Absolute path of `subpath` (starting `resources/`) for this plugin. */
	resolve(subpath: string): string;
}

/** Typed access to the main-process host services of a plugin's sdk. */
export function mainHost(sdk: PluginSdk): MainHostServices {
	if (sdk.process !== "main") {
		throw new KernelError("UNAVAILABLE", "Host services are only available in the main process.");
	}
	return sdk.host as unknown as MainHostServices;
}

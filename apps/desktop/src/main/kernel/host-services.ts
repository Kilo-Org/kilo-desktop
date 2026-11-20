import path from "node:path";

import {
	KernelError,
	type EmbeddedHostRegistration,
	type HostBrowser,
	type KvStoreOptions,
	type MainHostServices,
	type PluginHostServices,
	type PluginManifest,
} from "@kilo-desktop/kernel";

export interface HostServiceDeps {
	readonly storageDir: (pluginId: string) => string;
	readonly formerStorageDirs?: (pluginId: string) => readonly string[];
	readonly kv: (storageDir: string) => MainHostServices["storage"]["kv"];
	readonly fs: {
		readFile(pluginId: string, path: string): Promise<string>;
		writeFile(pluginId: string, path: string, content: string): Promise<void>;
		exists(pluginId: string, path: string): Promise<boolean>;
		mkdir(pluginId: string, path: string): Promise<void>;
		readdir(pluginId: string, path: string): Promise<string[]>;
		remove(pluginId: string, path: string): Promise<void>;
	};
	readonly fetch: typeof globalThis.fetch;
	/** Settles once the login shell's environment is applied to `process.env`. */
	readonly environmentReady?: Promise<unknown>;
	readonly protocol: {
		register(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
		unregister(scheme: string): void;
	};
	readonly embeddedHosts: {
		register(registration: EmbeddedHostRegistration): () => void;
	};
	readonly browser?: HostBrowser;
	readonly assets: {
		/** Set when packaged: plugins' `resources/` folders ship here (forge `extraResource`). */
		readonly packagedResourcesPath?: string;
		/** A bundled plugin's package folder during development. */
		pluginRoot(pluginId: string): string | undefined;
	};
}

/**
 * Builds the services injected into one plugin's main-process sdk. Storage,
 * kv and files are confined to the plugin; protocols, embedded hosts and the
 * browser host exist only when the manifest declares them, and only for the
 * names it declares.
 */
export function createHostServices(
	deps: HostServiceDeps,
	pluginId: string,
	manifest: PluginManifest | undefined,
): PluginHostServices {
	const dir = deps.storageDir(pluginId);
	let kvFactory: MainHostServices["storage"]["kv"] | undefined;
	const declaredSchemes = new Set(manifest?.permissions?.protocols ?? []);
	const declaredHosts = new Set(manifest?.permissions?.embeddedHosts ?? []);
	const hostPermissions = new Set(manifest?.permissions?.host ?? []);

	const services: MainHostServices = {
		storage: {
			dir,
			formerDirs: deps.formerStorageDirs?.(pluginId) ?? [],
			kv: <T extends Record<string, unknown>>(options: KvStoreOptions<T>) => {
				kvFactory ??= deps.kv(dir);
				return kvFactory(options);
			},
		},
		fs: {
			readFile: (path) => deps.fs.readFile(pluginId, path),
			writeFile: (path, content) => deps.fs.writeFile(pluginId, path, content),
			exists: (path) => deps.fs.exists(pluginId, path),
			mkdir: (path) => deps.fs.mkdir(pluginId, path),
			readdir: (path) => deps.fs.readdir(pluginId, path),
			remove: (path) => deps.fs.remove(pluginId, path),
		},
		net: { fetch: deps.fetch },
		...(deps.environmentReady
			? {
					environment: {
						ready: () =>
							deps.environmentReady!.then(
								() => undefined,
								() => undefined,
							),
					},
				}
			: {}),
		...(declaredSchemes.size > 0
			? {
					protocol: {
						handle(scheme, handler) {
							if (!declaredSchemes.has(scheme)) {
								throw new KernelError(
									"PERMISSION_DENIED",
									`"${pluginId}" did not declare the "${scheme}" protocol.`,
								);
							}
							deps.protocol.register(scheme, handler);
							return () => deps.protocol.unregister(scheme);
						},
					},
				}
			: {}),
		...(declaredHosts.size > 0
			? {
					embeddedHosts: {
						register(registration) {
							if (!declaredHosts.has(registration.host)) {
								throw new KernelError(
									"PERMISSION_DENIED",
									`"${pluginId}" did not declare the "${registration.host}" embedded host.`,
								);
							}
							return deps.embeddedHosts.register(registration);
						},
					},
				}
			: {}),
		...(hostPermissions.has("browser-host") && deps.browser !== undefined
			? { browser: deps.browser }
			: {}),
		assets: { resolve: (subpath) => resolveAsset(deps.assets, pluginId, subpath) },
	};
	return services as unknown as PluginHostServices;
}

const RESOURCES_PREFIX = "resources/";

/**
 * Packaged builds copy each plugin's `resources/<name>` to the app's
 * resources folder as `<name>`; development reads the plugin's folder.
 */
function resolveAsset(
	assets: HostServiceDeps["assets"],
	pluginId: string,
	subpath: string,
): string {
	const normalized = path.posix.normalize(subpath.replaceAll("\\", "/"));
	if (!normalized.startsWith(RESOURCES_PREFIX) || path.posix.isAbsolute(normalized)) {
		throw new KernelError(
			"VALIDATION",
			`Plugin assets live under "${RESOURCES_PREFIX}"; got "${subpath}".`,
		);
	}
	if (assets.packagedResourcesPath !== undefined) {
		return path.join(assets.packagedResourcesPath, normalized.slice(RESOURCES_PREFIX.length));
	}
	const root = assets.pluginRoot(pluginId);
	if (root === undefined) {
		throw new KernelError("UNAVAILABLE", `"${pluginId}" has no asset folder.`);
	}
	return path.join(root, normalized);
}

import {
	CommandRegistry,
	ContributionRegistry,
	createSdk,
	createObservableValue,
	createStaticNavigation,
	FeatureRouter,
	StateBroker,
	teardownFeature as teardownSdkFeature,
	ToolRegistry,
} from "@anaconda-agentic-desktop/feature-sdk";

import type {
	ChannelHandlerMap,
	ChannelMap,
	KvStore,
	KvStoreFactory,
	KvStoreOptions,
	MainSdk,
	MainSdkFetch,
	MainSdkLogger,
	MainSdkProtocol,
	SDK,
	SdkFactoryServices,
	ShellDelegates,
	ShellFsDelegate,
	SdkTheme,
	ThemeAppearance,
} from "@anaconda-agentic-desktop/feature-sdk";

const noop = () => {};
const DEFAULT_APPEARANCES: Record<"light" | "dark", ThemeAppearance> = {
	light: { mode: "light", themeId: "anaconda", terminal: null, shiki: "pierre-light" },
	dark: { mode: "dark", themeId: "anaconda", terminal: null, shiki: "pierre-dark" },
};

/** Observable shell theme fake; preserves snapshot identity until explicitly updated. */
export function createFakeTheme(initial = DEFAULT_APPEARANCES.light): SdkTheme & {
	setAppearance(next: ThemeAppearance): void;
} {
	const appearance = createObservableValue(initial);
	return {
		appearance: appearance.peek,
		subscribe(fn) {
			fn();
			return appearance.subscribe(() => fn());
		},
		setAppearance: (next) => {
			appearance.set(next);
		},
	};
}
const noopMainSdkLogger = {
	info: noop,
	warn: noop,
	error: noop,
} satisfies MainSdkLogger;

function createInMemoryKvStoreFactory(): KvStoreFactory {
	return <T extends Record<string, unknown>>(options: KvStoreOptions<T>): KvStore<T> => {
		const defaults = { ...options.defaults } as T;
		let state: T = { ...defaults };
		return {
			snapshot: () => ({ ...state }),
			get: (key) => state[key],
			set: (patch) => {
				const next = { ...state } as T;
				for (const key of Object.keys(patch) as Array<keyof T>) {
					const value = patch[key];
					if (value !== undefined) next[key] = value as T[typeof key];
				}
				state = next;
				return { ...next };
			},
			clear: () => {
				state = { ...defaults };
			},
		};
	};
}

/**
 * In-memory `sdk.fs` fake mirroring the production scoping model: paths are
 * relative to a per-feature sandbox, and absolute or escaping (`..`) paths
 * are rejected — so a test catches a path bug the same way production would.
 * State lives per fake instance; nothing touches the real filesystem.
 */
function createInMemoryShellFs(): ShellFsDelegate {
	type Tree = { files: Map<string, string>; dirs: Set<string> };
	const trees = new Map<string, Tree>();

	const tree = (featureId: string): Tree => {
		let entry = trees.get(featureId);
		if (!entry) {
			// The sandbox root ("") always exists, matching the lazily created
			// production sandbox dir.
			entry = { files: new Map(), dirs: new Set([""]) };
			trees.set(featureId, entry);
		}
		return entry;
	};

	const normalize = (relativePath: string): string => {
		if (relativePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relativePath)) {
			throw new Error(
				`[FakeSdk] sdk.fs paths must be relative to the feature's sandbox directory: "${relativePath}".`,
			);
		}
		const parts: string[] = [];
		for (const segment of relativePath.split("/")) {
			if (segment === "" || segment === ".") continue;
			if (segment === "..") {
				if (parts.length === 0) {
					throw new Error(
						`[FakeSdk] sdk.fs paths cannot escape the feature's sandbox directory: "${relativePath}".`,
					);
				}
				parts.pop();
				continue;
			}
			parts.push(segment);
		}
		return parts.join("/");
	};

	const addAncestorDirs = (entry: Tree, key: string): void => {
		const parts = key.split("/");
		for (let index = 1; index < parts.length; index += 1) {
			entry.dirs.add(parts.slice(0, index).join("/"));
		}
	};

	// Mirror production ScopedFsService: a path segment cannot be both a file
	// and a directory. Reject when an ancestor is already a file (ENOTDIR).
	const assertAncestorsAreDirs = (entry: Tree, key: string, relativePath: string): void => {
		const parts = key.split("/");
		for (let index = 1; index < parts.length; index += 1) {
			const ancestor = parts.slice(0, index).join("/");
			if (entry.files.has(ancestor)) {
				throw new Error(`[FakeSdk] sdk.fs: "${relativePath}" is not a directory.`);
			}
		}
	};

	return {
		async readFile(featureId, relativePath) {
			const key = normalize(relativePath);
			const content = tree(featureId).files.get(key);
			if (content === undefined) {
				throw new Error(`[FakeSdk] sdk.fs: no such file or directory: "${relativePath}".`);
			}
			return content;
		},
		async writeFile(featureId, relativePath, content) {
			const key = normalize(relativePath);
			const entry = tree(featureId);
			if (entry.dirs.has(key)) {
				throw new Error(`[FakeSdk] sdk.fs: "${relativePath}" is a directory.`);
			}
			assertAncestorsAreDirs(entry, key, relativePath);
			addAncestorDirs(entry, key);
			entry.files.set(key, content);
		},
		async exists(featureId, relativePath) {
			const key = normalize(relativePath);
			const entry = tree(featureId);
			return entry.files.has(key) || entry.dirs.has(key);
		},
		async mkdir(featureId, relativePath) {
			const key = normalize(relativePath);
			const entry = tree(featureId);
			if (entry.files.has(key)) {
				throw new Error(`[FakeSdk] sdk.fs: "${relativePath}" is not a directory.`);
			}
			assertAncestorsAreDirs(entry, key, relativePath);
			addAncestorDirs(entry, key);
			entry.dirs.add(key);
		},
		async readdir(featureId, relativePath) {
			const key = normalize(relativePath);
			const entry = tree(featureId);
			if (!entry.dirs.has(key)) {
				throw new Error(`[FakeSdk] sdk.fs: no such file or directory: "${relativePath}".`);
			}
			const prefix = key === "" ? "" : `${key}/`;
			const children = new Set<string>();
			for (const candidate of [...entry.files.keys(), ...entry.dirs]) {
				if (candidate === "" || candidate === key || !candidate.startsWith(prefix)) continue;
				children.add(candidate.slice(prefix.length).split("/")[0]!);
			}
			return [...children].sort();
		},
		async remove(featureId, relativePath) {
			const key = normalize(relativePath);
			const entry = tree(featureId);
			if (key === "") {
				entry.files.clear();
				entry.dirs.clear();
				entry.dirs.add("");
				return;
			}
			const prefix = `${key}/`;
			for (const file of [...entry.files.keys()]) {
				if (file === key || file.startsWith(prefix)) entry.files.delete(file);
			}
			for (const dir of [...entry.dirs]) {
				if (dir === key || dir.startsWith(prefix)) entry.dirs.delete(dir);
			}
		},
	};
}

/**
 * Adapt featureId-free `sdk.fs` overrides (what feature tests naturally
 * write) onto the featureId-scoped delegate, falling back to the in-memory
 * fake for methods left out.
 */
function adaptFsOverrides(base: ShellFsDelegate, overrides: Partial<SDK["fs"]>): ShellFsDelegate {
	return {
		readFile: (featureId, p) =>
			overrides.readFile ? overrides.readFile(p) : base.readFile(featureId, p),
		writeFile: (featureId, p, content) =>
			overrides.writeFile ? overrides.writeFile(p, content) : base.writeFile(featureId, p, content),
		exists: (featureId, p) => (overrides.exists ? overrides.exists(p) : base.exists(featureId, p)),
		mkdir: (featureId, p) => (overrides.mkdir ? overrides.mkdir(p) : base.mkdir(featureId, p)),
		readdir: (featureId, p) =>
			overrides.readdir ? overrides.readdir(p) : base.readdir(featureId, p),
		remove: (featureId, p) => (overrides.remove ? overrides.remove(p) : base.remove(featureId, p)),
	};
}

/** Merge partial overrides into a base object, ignoring undefined values. */
function merge<T extends object>(base: T, overrides?: Partial<T>): T {
	if (!overrides) return base;
	const result = { ...base };
	for (const [key, value] of Object.entries(overrides)) {
		if (value !== undefined) {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}

type FakeSdkShellOptions = {
	events?: Partial<SDK["events"]>;
	state?: Partial<SDK["state"]>;
	plugins?: Partial<SDK["plugins"]>;
	contribute?: SDK["contribute"];
	commands?: Partial<SDK["commands"]>;
	notifications?: Partial<SDK["notifications"]>;
	telemetry?: Partial<SDK["telemetry"]>;
	theme?: Partial<SDK["theme"]>;
	auth?: Partial<SDK["auth"]>;
	featureFlags?: Partial<SDK["featureFlags"]>;
	shell?: Partial<SDK["shell"]>;
	/**
	 * Override the fs delegate (featureId-free, like `sdk.fs`). Defaults to a
	 * working in-memory filesystem scoped per feature.
	 */
	fs?: Partial<SDK["fs"]>;
	/** Override the shell navigation delegate (sdk.navigate + sdk.location). */
	navigation?: Partial<ShellDelegates["navigation"]>;
	onDispose?: SDK["onDispose"];
	destroy?: SDK["destroy"];
};

/**
 * Options for createFakeSdk without a channel map — for tests that only exercise
 * events/state/plugins/shell delegates (or override invoke entirely).
 */
export type FakeSdkOptions = FakeSdkShellOptions & {
	featureId: string;
	invoke?: SDK["invoke"];
};

/**
 * Options for createFakeSdk with a channel map — registers typed handlers on
 * the fake's real in-memory FeatureRouter so `sdk.client` calls work.
 */
export type FakeSdkOptionsWithChannels<C extends ChannelMap> = FakeSdkShellOptions & {
	featureId: string;
	channels: C;
	handlers?: Partial<ChannelHandlerMap<C>>;
	invoke?: SDK["invoke"];
};

/** SDK plus the backing in-memory services, for assertions in tests. */
export type FakeSdk = SDK & { readonly services: SdkFactoryServices };

function buildFakeServices(options: FakeSdkShellOptions): SdkFactoryServices {
	const featureRouter = new FeatureRouter();
	const memoryFs = createInMemoryShellFs();
	const appearance = options.theme?.appearance ?? (() => DEFAULT_APPEARANCES.light);
	const shellDelegates: ShellDelegates = {
		// The fake reports successful delivery so feature code that checks the
		// envelope takes its happy path in tests. Override to simulate absence.
		notifications: merge<SDK["notifications"]>(
			{ show: async () => ({ delivered: true }), setBadge: async () => ({ delivered: true }) },
			options.notifications,
		),
		telemetry: merge<SDK["telemetry"]>({ track: async () => {} }, options.telemetry),
		theme: merge<SDK["theme"]>(
			{
				subscribe: (fn) => {
					fn();
					return noop;
				},
				appearance,
			},
			options.theme,
		),
		auth: merge<SDK["auth"]>(
			{
				subscribe: (fn) => {
					fn({ status: "anonymous" });
					return noop;
				},
				peek: () => ({ status: "anonymous" }),
				getSession: async () => ({ status: "anonymous" }),
				refresh: async () => ({ status: "anonymous" }),
				login: async () => ({ status: "anonymous" }),
				logout: async () => ({ status: "anonymous" }),
			},
			options.auth,
		),
		featureFlags: merge<SDK["featureFlags"]>(
			{
				getAllFlags: async () => ({}),
				subscribe: (fn) => {
					fn({});
					return noop;
				},
				peek: () => ({}),
			},
			options.featureFlags,
		),
		shell: merge<SDK["shell"]>(
			{
				canPickDirectories: true,
				canPopOutPanes: true,
				windowRole: "main",
				openExternal: async () => ({ opened: true }),
				copyText: async () => undefined,
				showItemInFolder: async () => ({ revealed: true }),
				showOpenDialog: async () => ({ canceled: true, paths: [] }),
				getPathForFile: () => null,
				openPaneWindow: async () => ({ opened: true }),
				listPaneWindows: async () => [],
				focusPaneWindow: async () => ({ focused: true }),
				dockPaneWindow: async () => ({ docked: true }),
				syncPaneWindows: async () => undefined,
				onPaneWindowChanged: () => noop,
			},
			options.shell,
		),
		// In-memory scoped fs (per fake instance) mirroring the production
		// sandbox semantics. Override individual methods to force failures or
		// record calls.
		fs: options.fs ? adaptFsOverrides(memoryFs, options.fs) : memoryFs,
		// The fake pins the location to "/" and navigation is a no-op — the
		// shared static delegate keeps the subscribe-fires-synchronously
		// contract aligned with production. Override to record navigations or
		// to drive location updates from the test.
		navigation: merge<ShellDelegates["navigation"]>(createStaticNavigation(), options.navigation),
	};

	return {
		stateBroker: new StateBroker(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		toolRegistry: new ToolRegistry(),
		featureRouter,
		shellDelegates,
	};
}

function applySdkOverrides(
	sdk: SDK,
	services: SdkFactoryServices,
	options: FakeSdkShellOptions & { invoke?: SDK["invoke"] },
): FakeSdk {
	return {
		...sdk,
		services,
		invoke: options.invoke ?? sdk.invoke,
		events: merge(sdk.events, options.events),
		state: merge(sdk.state, options.state),
		plugins: merge(sdk.plugins, options.plugins),
		contribute: options.contribute ?? sdk.contribute,
		commands: merge(sdk.commands, options.commands),
		onDispose: options.onDispose ?? sdk.onDispose,
		destroy: options.destroy ?? sdk.destroy,
	};
}

/**
 * Create a fake SDK for testing feature renderer code.
 *
 * Built on the REAL createSdk with real in-memory services (event bus, state
 * broker, registries, router), so events/state/plugins behave exactly like
 * production. Only the shell delegates are fakes (theme is "light",
 * notifications report delivered, fs is an in-memory sandbox). Pass `channels`
 * (+ optional `handlers`) to register handlers on the router so `sdk.client`
 * works.
 */
export function createFakeSdk(options: FakeSdkOptions): FakeSdk;
export function createFakeSdk<C extends ChannelMap>(
	options: FakeSdkOptionsWithChannels<C>,
): FakeSdk;
export function createFakeSdk<C extends ChannelMap>(
	options: FakeSdkOptions | FakeSdkOptionsWithChannels<C>,
): FakeSdk {
	const services = buildFakeServices(options);
	const base = createSdk(options.featureId, services);

	if ("channels" in options && options.channels) {
		const channels = options.channels;
		if (options.handlers) {
			const api = services.featureRouter.createMainSdk(options.featureId).channels(channels);
			for (const channel of Object.keys(options.handlers) as Array<keyof C & string>) {
				const handler = options.handlers[channel];
				if (handler) {
					api.handle(channel, handler);
				}
			}
		}
	}

	return applySdkOverrides(base, services, options);
}

/**
 * Minimal FeatureSystem stand-in for renderer tests that mount views under
 * `<SdkProvider>`. Shape matches apps/web `FeatureSystem` without depending on
 * the web package.
 */
export type FakeFeatureSystem = {
	readonly services: SdkFactoryServices;
	getSdk(featureId: string): SDK;
	teardownFeature(featureId: string): void;
	dispose(): void;
};

export type FakeFeatureSystemOptions = {
	/** Pre-built SDK instances keyed by feature id. */
	sdks: Readonly<Record<string, SDK>>;
	/**
	 * Shared factory services. Defaults to the first `FakeSdk`'s `.services`
	 * when at least one entry was created via `createFakeSdk`.
	 */
	services?: SdkFactoryServices;
};

/**
 * Build a fake FeatureSystem from a map of feature SDKs that share one
 * service bus. Unknown `getSdk` ids get a live `createSdk` on the shared
 * services; `teardownFeature` destroys and drops the named entry.
 */
export function createFakeFeatureSystem(options: FakeFeatureSystemOptions): FakeFeatureSystem {
	const cache = new Map<string, SDK>(Object.entries(options.sdks));

	let services = options.services;
	if (!services) {
		for (const sdk of cache.values()) {
			if ("services" in sdk && (sdk as FakeSdk).services) {
				services = (sdk as FakeSdk).services;
				break;
			}
		}
	}
	if (!services) {
		throw new Error(
			"createFakeFeatureSystem requires `services` or at least one FakeSdk (from createFakeSdk).",
		);
	}

	const shared = services;
	let disposed = false;

	function assertActive(): void {
		if (disposed) throw new Error("FakeFeatureSystem has been disposed.");
	}

	function teardown(featureId: string): void {
		cache.get(featureId)?.destroy();
		cache.delete(featureId);
		teardownSdkFeature(featureId, shared);
	}

	return {
		services: shared,
		getSdk(featureId: string): SDK {
			assertActive();
			const existing = cache.get(featureId);
			if (existing) return existing;
			const created = createSdk(featureId, shared);
			cache.set(featureId, created);
			return created;
		},
		teardownFeature(featureId: string): void {
			assertActive();
			teardown(featureId);
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const featureId of [...cache.keys()]) teardown(featureId);
		},
	};
}

/**
 * Create a fake MainSdk for testing feature main-process registration.
 * Backed by a real FeatureRouter — invoke/has go through the same validation
 * path as production, and dispose runs the same teardown.
 *
 * `storageDir` defaults to a lazily created temp directory (Node only);
 * pass `storageDir` to control where the feature persists in the test.
 *
 * `pluginDir` powers `mainSdk.resolvePluginAsset(subpath)`: pass the
 * plugin package root (or any directory holding the assets the test needs)
 * and the fake resolves `subpath` against it. Omit for tests that never
 * call `resolvePluginAsset`; access then throws with the shell's error.
 */
export type FakeMainSdk = MainSdk & {
	/** Invoke a registered handler, validating args/output like the real router. */
	invoke(channel: string, args?: unknown): Promise<unknown>;
	/** Whether a handler is registered for the channel. */
	has(channel: string): boolean;
	/** Tear the feature down like the shell does on unload/shutdown. */
	dispose(): void;
	/** Tear the feature down and await asynchronous cleanup. */
	disposeAsync(): Promise<void>;
};

export interface FakeMainSdkOptions {
	featureId?: string;
	storageDir?: string;
	pluginDir?: string;
	/** Feature-scoped logger fake. Defaults to a no-op logger. */
	logger?: MainSdkLogger;
	/** Network fake. Defaults to the current runtime's global fetch. */
	fetch?: MainSdkFetch;
	/** Optional desktop host capabilities for main-process plugin tests. */
	host?: MainSdk["host"];
	/** Custom protocol delegate (manifest-declared schemes) for main-process plugin tests. */
	protocol?: MainSdkProtocol;
	/** Optional KV factory; defaults to an isolated in-memory implementation. */
	createKvStore?: KvStoreFactory;
	/**
	 * Receive `mainSdk.boot.reportProgress(msg)` calls. Defaults to a no-op
	 * (production behaviour after `bootFeatures` returns). Pass a spy to
	 * assert on progress messages emitted from `mainRegister`.
	 */
	reportBootProgress?: (message: string) => void;
	/** Internal shared services; prefer createLinkedFakeSdkPair for linked tests. */
	services?: SdkFactoryServices;
}

export function createFakeMainSdk(options?: FakeMainSdkOptions): FakeMainSdk {
	const featureId = options?.featureId ?? "test-feature";
	const router = options?.services?.featureRouter ?? new FeatureRouter();
	const pluginDir = options?.pluginDir;
	const createKvStore = options?.createKvStore ?? createInMemoryKvStoreFactory();
	const mainSdk = router.createMainSdk(featureId, {
		logger: options?.logger ?? noopMainSdkLogger,
		fetch: options?.fetch ?? ((input, init) => globalThis.fetch(input, init)),
		...(options?.host ? { host: options.host } : {}),
		...(options?.protocol ? { protocol: options.protocol } : {}),
		createKvStore,
		resolveStorageDir: () => {
			if (options?.storageDir !== undefined) return options.storageDir;
			// Node-only, resolved lazily via process.getBuiltinModule so this
			// module stays importable in browser tests (which never access it).
			const fs = process.getBuiltinModule("node:fs");
			const os = process.getBuiltinModule("node:os");
			const path = process.getBuiltinModule("node:path");
			return fs.mkdtempSync(path.join(os.tmpdir(), `fake-${featureId}-`));
		},
		...(pluginDir === undefined
			? {}
			: {
					resolvePluginAsset: (subpath: string) => {
						const path = process.getBuiltinModule("node:path");
						return path.resolve(pluginDir, subpath);
					},
				}),
		...(options?.reportBootProgress ? { reportBootProgress: options.reportBootProgress } : {}),
	});

	return {
		featureId: mainSdk.featureId,
		logger: mainSdk.logger,
		net: mainSdk.net,
		events: mainSdk.events,
		plugins: mainSdk.plugins,
		boot: mainSdk.boot,
		storage: mainSdk.storage,
		ports: mainSdk.ports,
		host: mainSdk.host,
		protocol: mainSdk.protocol,
		// Delegate instead of spreading — spreading would eagerly invoke the
		// lazy storageDir getter and create a temp dir every test.
		get storageDir() {
			return mainSdk.storageDir;
		},
		resolvePluginAsset: mainSdk.resolvePluginAsset,
		channels: mainSdk.channels,
		onDispose: mainSdk.onDispose,
		invoke: (channel, args) => router.invoke(featureId, channel, args),
		has: (channel) => router.has(featureId, channel),
		dispose: () => router.destroyFeature(featureId),
		disposeAsync: () => router.destroyFeatureAsync(featureId),
	};
}

/**
 * Capturing `MainSdkProtocol` fake: records the handlers a feature's
 * `mainRegister` installs (keyed by scheme) so integration tests can invoke
 * them directly with `Request` objects, and observe teardown semantics,
 * without Electron. `handler` exposes the most recently registered handler
 * for the common single-scheme plugin.
 */
export function createFakeMainSdkProtocol(): MainSdkProtocol & {
	readonly handlers: ReadonlyMap<string, (request: Request) => Promise<Response> | Response>;
	readonly handler: ((request: Request) => Promise<Response> | Response) | undefined;
} {
	const handlers = new Map<string, (request: Request) => Promise<Response> | Response>();
	return {
		handle(scheme, next) {
			handlers.set(scheme, next);
		},
		get handlers() {
			return handlers;
		},
		get handler() {
			return [...handlers.values()].at(-1);
		},
	};
}

/**
 * Create renderer and main SDKs backed by one real EventBus, capability
 * registry, and FeatureRouter. Use this for cross-boundary feature tests that
 * should exercise the browser-mode semantics without hand-wiring services.
 */
export function createLinkedFakeSdkPair(options?: {
	featureId?: string;
	main?: Omit<FakeMainSdkOptions, "featureId" | "services">;
}): {
	rendererSdk: FakeSdk;
	mainSdk: FakeMainSdk;
	createMainSdk(
		featureId: string,
		options?: Omit<FakeMainSdkOptions, "featureId" | "services">,
	): FakeMainSdk;
} {
	const featureId = options?.featureId ?? "test-feature";
	const services = buildFakeServices({});
	const rendererSdk = applySdkOverrides(createSdk(featureId, services), services, {});
	const mainSdk = createFakeMainSdk({ featureId, services, ...options?.main });
	return {
		rendererSdk,
		mainSdk,
		createMainSdk: (targetFeatureId, targetOptions) =>
			createFakeMainSdk({ featureId: targetFeatureId, services, ...targetOptions }),
	};
}

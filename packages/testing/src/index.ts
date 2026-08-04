import {
	CommandRegistry,
	ContributionRegistry,
	createSdk,
	createStaticNavigation,
	FeatureRouter,
	StateBroker,
	teardownFeature as teardownSdkFeature,
} from "@anaconda-agentic-desktop/feature-sdk";

import type {
	ChannelHandlerMap,
	ChannelMap,
	MainSdk,
	SDK,
	SdkFactoryServices,
	ShellDelegates,
} from "@anaconda-agentic-desktop/feature-sdk";

const noop = () => {};

function notImplemented(method: string): (...args: never[]) => Promise<never> {
	return async () => {
		throw new Error(
			`[FakeSdk] ${method} not implemented in test. Override it via createFakeSdk().`,
		);
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
	theme?: Partial<SDK["theme"]>;
	auth?: Partial<SDK["auth"]>;
	shell?: Partial<SDK["shell"]>;
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
	const shellDelegates: ShellDelegates = {
		// The fake reports successful delivery so feature code that checks the
		// envelope takes its happy path in tests. Override to simulate absence.
		notifications: merge<SDK["notifications"]>(
			{ show: () => ({ delivered: true }), setBadge: () => ({ delivered: true }) },
			options.notifications,
		),
		theme: merge<SDK["theme"]>(
			{
				subscribe: (fn) => {
					fn("light");
					return noop;
				},
				peek: () => "light",
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
		shell: merge<SDK["shell"]>(
			{
				canPickDirectories: true,
				openExternal: async () => ({ opened: true }),
				copyText: async () => undefined,
				showOpenDialog: async () => ({ canceled: true, paths: [] }),
				getPathForFile: () => null,
			},
			options.shell,
		),
		fs: merge<SDK["fs"]>(
			{
				readFile: notImplemented("sdk.fs.readFile"),
				writeFile: notImplemented("sdk.fs.writeFile"),
				exists: notImplemented("sdk.fs.exists"),
				mkdir: notImplemented("sdk.fs.mkdir"),
				readdir: notImplemented("sdk.fs.readdir"),
				remove: notImplemented("sdk.fs.remove"),
			},
			options.fs,
		),
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
 * notifications no-op, fs throws until overridden). Pass `channels` (+ optional
 * `handlers`) to register handlers on the router so `sdk.client` works.
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
};

export function createFakeMainSdk(options?: {
	featureId?: string;
	storageDir?: string;
	pluginDir?: string;
	/** Internal shared services; prefer createLinkedFakeSdkPair for linked tests. */
	services?: SdkFactoryServices;
}): FakeMainSdk {
	const featureId = options?.featureId ?? "test-feature";
	const router = options?.services?.featureRouter ?? new FeatureRouter();
	const pluginDir = options?.pluginDir;
	const mainSdk = router.createMainSdk(featureId, {
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
	});

	return {
		featureId: mainSdk.featureId,
		events: mainSdk.events,
		plugins: mainSdk.plugins,
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
	};
}

/**
 * Create renderer and main SDKs backed by one real EventBus, capability
 * registry, and FeatureRouter. Use this for cross-boundary feature tests that
 * should exercise the browser-mode semantics without hand-wiring services.
 */
export function createLinkedFakeSdkPair(options?: { featureId?: string }): {
	rendererSdk: FakeSdk;
	mainSdk: FakeMainSdk;
	createMainSdk(featureId: string): FakeMainSdk;
} {
	const featureId = options?.featureId ?? "test-feature";
	const services = buildFakeServices({});
	const rendererSdk = applySdkOverrides(createSdk(featureId, services), services, {});
	const mainSdk = createFakeMainSdk({ featureId, services });
	return {
		rendererSdk,
		mainSdk,
		createMainSdk: (targetFeatureId) => createFakeMainSdk({ featureId: targetFeatureId, services }),
	};
}

import {
	CapabilityRegistry,
	CommandRegistry,
	ContributionRegistry,
	createSdk,
	EventBus,
	FeatureRouter,
	StateBroker,
	withChannels,
} from "@anaconda-agentic-desktop/feature-sdk";

import type {
	ChannelHandlerInput,
	ChannelHandlerOutput,
	ChannelMap,
	MainSdk,
	SDK,
	SdkFactoryServices,
	ShellDelegates,
	TypedSDK,
} from "@anaconda-agentic-desktop/feature-sdk";

const noop = () => {};

function notImplemented(method: string): (...args: never[]) => never {
	return () => {
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
	shell?: Partial<SDK["shell"]>;
	fs?: Partial<SDK["fs"]>;
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
 * Options for createFakeSdk with a channel map — enables typed invoke and
 * typed handlers registered on the fake's real in-memory FeatureRouter.
 */
export type FakeSdkOptionsWithChannels<C extends ChannelMap> = FakeSdkShellOptions & {
	featureId: string;
	channels: C;
	handlers?: Partial<{
		[K in keyof C]: (
			args: ChannelHandlerInput<C[K]>,
		) => ChannelHandlerOutput<C[K]> | Promise<ChannelHandlerOutput<C[K]>>;
	}>;
	invoke?: TypedSDK<C>["invoke"];
};

/** SDK plus the backing in-memory services, for assertions in tests. */
export type FakeSdk<C extends ChannelMap | undefined = undefined> = (C extends ChannelMap
	? TypedSDK<C>
	: SDK) & {
	readonly services: SdkFactoryServices;
};

function buildFakeServices(options: FakeSdkShellOptions): SdkFactoryServices {
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
		shell: merge<SDK["shell"]>(
			{
				openExternal: async () => ({ opened: true }),
				copyText: async () => undefined,
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
	};

	return {
		eventBus: new EventBus(),
		stateBroker: new StateBroker(),
		capabilityRegistry: new CapabilityRegistry(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		featureRouter: new FeatureRouter(),
		shellDelegates,
	};
}

function applySdkOverrides<T extends SDK>(
	sdk: T,
	services: SdkFactoryServices,
	options: FakeSdkShellOptions & { invoke?: T["invoke"] },
): T & { readonly services: SdkFactoryServices } {
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
 * `handlers`) for typed sdk.invoke; omit them when the test only needs shell
 * surface or an invoke override.
 */
export function createFakeSdk(options: FakeSdkOptions): FakeSdk;
export function createFakeSdk<C extends ChannelMap>(
	options: FakeSdkOptionsWithChannels<C>,
): FakeSdk<C>;
export function createFakeSdk<C extends ChannelMap>(
	options: FakeSdkOptions | FakeSdkOptionsWithChannels<C>,
): FakeSdk | FakeSdk<C> {
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
		return applySdkOverrides(withChannels(base, channels), services, options);
	}

	return applySdkOverrides(base, services, options);
}

/**
 * Create a fake MainSdk for testing feature main-process registration.
 * Backed by a real FeatureRouter — invoke/has go through the same validation
 * path as production.
 */
export function createFakeMainSdk(options?: { featureId?: string }): MainSdk & {
	/** Invoke a registered handler, validating args/output like the real router. */
	invoke(channel: string, args?: unknown): Promise<unknown>;
	/** Whether a handler is registered for the channel. */
	has(channel: string): boolean;
} {
	const featureId = options?.featureId ?? "test-feature";
	const router = new FeatureRouter();
	const mainSdk = router.createMainSdk(featureId);

	return {
		...mainSdk,
		invoke: (channel, args) => router.invoke(featureId, channel, args),
		has: (channel) => router.has(featureId, channel),
	};
}

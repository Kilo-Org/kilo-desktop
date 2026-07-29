import {
	CapabilityRegistry,
	CommandRegistry,
	ContributionRegistry,
	createSdk,
	EventBus,
	FeatureRouter,
	StateBroker,
} from "@anaconda-agentic-desktop/feature-sdk";

import type {
	MainSdk,
	SchemaLike,
	SDK,
	SdkFactoryServices,
	ShellDelegates,
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

/**
 * Options for createFakeSdk. Provide only the methods your test exercises.
 */
export interface FakeSdkOptions {
	featureId: string;
	/**
	 * Backend handlers for sdk.invoke, keyed by channel. Registered on the
	 * fake's real in-memory FeatureRouter — prefer this over overriding invoke.
	 */
	handlers?: Record<string, (args: unknown) => unknown | Promise<unknown>>;
	invoke?: SDK["invoke"];
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
}

/** SDK plus the backing in-memory services, for assertions in tests. */
export type FakeSdk = SDK & { readonly services: SdkFactoryServices };

/**
 * Create a fake SDK for testing feature renderer code.
 *
 * Built on the REAL createSdk with real in-memory services (event bus, state
 * broker, registries, router), so events/state/plugins behave exactly like
 * production. Only the shell delegates are fakes (theme is "light",
 * notifications no-op, fs throws until overridden). Use `handlers` to serve
 * sdk.invoke calls; use the option overrides for anything else.
 */
export function createFakeSdk(options: FakeSdkOptions): FakeSdk {
	const shellDelegates: ShellDelegates = {
		notifications: merge<SDK["notifications"]>(
			{ show: noop, setBadge: noop },
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

	const services: SdkFactoryServices = {
		eventBus: new EventBus(),
		stateBroker: new StateBroker(),
		capabilityRegistry: new CapabilityRegistry(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		featureRouter: new FeatureRouter(),
		shellDelegates,
	};

	if (options.handlers) {
		const mainSdk = services.featureRouter.createMainSdk(options.featureId);
		for (const [channel, handler] of Object.entries(options.handlers)) {
			mainSdk.handle(channel, null, handler);
		}
	}

	const sdk = createSdk(options.featureId, services);

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
 * Create a fake MainSdk for testing feature main-process registration.
 * Tracks which handlers and schemas were registered.
 */
export function createFakeMainSdk(options?: { featureId?: string }): MainSdk & {
	/** Map of registered handlers (channel → handler fn). */
	registeredHandlers: Map<string, (args: never) => unknown | Promise<unknown>>;
	/** Map of registered input schemas (channel → schema or null). */
	registeredSchemas: Map<string, SchemaLike | null>;
	/** List of dispose callbacks registered via onDispose(). */
	disposeCallbacks: Array<() => void>;
	/** Invoke a registered handler, validating args like the real router. */
	invoke(channel: string, args?: unknown): Promise<unknown>;
} {
	const registeredHandlers = new Map<string, (args: never) => unknown | Promise<unknown>>();
	const registeredSchemas = new Map<string, SchemaLike | null>();
	const disposeCallbacks: Array<() => void> = [];
	const featureId = options?.featureId ?? "test-feature";

	return {
		featureId,
		handle(channel, inputSchema, handler) {
			registeredHandlers.set(channel, handler);
			registeredSchemas.set(channel, inputSchema);
		},
		onDispose(fn) {
			disposeCallbacks.push(fn);
		},
		registeredHandlers,
		registeredSchemas,
		disposeCallbacks,
		async invoke(channel, args) {
			const handler = registeredHandlers.get(channel);
			if (!handler) {
				throw new Error(`[FakeMainSdk] No handler registered for channel "${channel}".`);
			}
			const schema = registeredSchemas.get(channel);
			const parsed = schema ? schema.parse(args) : args;
			return (handler as (args: unknown) => unknown | Promise<unknown>)(parsed);
		},
	};
}

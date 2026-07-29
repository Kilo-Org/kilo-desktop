import type { MainSdk, SDK } from "@anaconda-agentic-desktop/feature-sdk";

const noop = () => {};
const asyncNoop = async () => undefined as unknown;
const noopUnsub = () => noop;

function notImplemented(method: string): (...args: unknown[]) => never {
	return () => {
		throw new Error(
			`[FakeSdk] ${method} not implemented in test. Override it via createFakeSdk().`,
		);
	};
}

/**
 * Options for createFakeSdk. Provide only the methods your test exercises.
 */
export interface FakeSdkOptions {
	featureId: string;
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

/**
 * Create a fake SDK for testing feature renderer code.
 * Override only the methods your test exercises; everything else throws or no-ops.
 */
export function createFakeSdk(options: FakeSdkOptions): SDK {
	const { featureId } = options;

	return {
		featureId,
		invoke: options.invoke ?? (asyncNoop as SDK["invoke"]),
		events: {
			emit: options.events?.emit ?? noop,
			on: options.events?.on ?? noopUnsub,
			off: options.events?.off ?? noop,
		},
		state: {
			register: options.state?.register ?? ((_name: string, _init: unknown) => ({ set: noop })),
			get:
				options.state?.get ??
				(((_key: string) => ({
					subscribe: (fn: (v: unknown) => void) => {
						fn(null);
						return noop;
					},
					peek: () => null as unknown,
				})) as SDK["state"]["get"]),
			peek: options.state?.peek ?? (() => null),
		},
		plugins: {
			expose: options.plugins?.expose ?? noop,
			get: options.plugins?.get ?? (() => null),
		},
		contribute: options.contribute ?? noop,
		commands: {
			register: options.commands?.register ?? noop,
		},
		notifications: {
			show: options.notifications?.show ?? noop,
			setBadge: options.notifications?.setBadge ?? noop,
		},
		theme: {
			subscribe: options.theme?.subscribe ?? noopUnsub,
			peek: options.theme?.peek ?? (() => "light" as const),
			getEffective: options.theme?.getEffective ?? (() => "light" as const),
		},
		shell: {
			openExternal: options.shell?.openExternal ?? (async () => ({ opened: true })),
			copyText: options.shell?.copyText ?? (async () => undefined),
		},
		fs: {
			readFile: options.fs?.readFile ?? notImplemented("sdk.fs.readFile"),
			writeFile: options.fs?.writeFile ?? notImplemented("sdk.fs.writeFile"),
			exists: options.fs?.exists ?? notImplemented("sdk.fs.exists"),
			mkdir: options.fs?.mkdir ?? notImplemented("sdk.fs.mkdir"),
			readdir: options.fs?.readdir ?? notImplemented("sdk.fs.readdir"),
			remove: options.fs?.remove ?? notImplemented("sdk.fs.remove"),
		},
		tools: {
			register: notImplemented("sdk.tools.register"),
			invoke: notImplemented("sdk.tools.invoke") as unknown as SDK["tools"]["invoke"],
			all: notImplemented("sdk.tools.all"),
		},
		intents: {
			list: notImplemented("sdk.intents.list"),
		},
		navigate: notImplemented("sdk.navigate") as unknown as SDK["navigate"],
		dispatch: notImplemented("sdk.dispatch") as unknown as SDK["dispatch"],
		onDispose: options.onDispose ?? noop,
		destroy: options.destroy ?? noop,
	};
}

/**
 * Create a fake MainSdk for testing feature main-process registration.
 * Tracks which handlers were registered.
 */
export function createFakeMainSdk(options?: { featureId?: string }): MainSdk & {
	/** Map of registered handlers (channel → handler fn). */
	registeredHandlers: Map<string, (args: unknown) => unknown | Promise<unknown>>;
	/** List of dispose callbacks registered via onDispose(). */
	disposeCallbacks: Array<() => void>;
} {
	const registeredHandlers = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
	const disposeCallbacks: Array<() => void> = [];

	return {
		featureId: options?.featureId ?? "test-feature",
		handle(channel, handler) {
			registeredHandlers.set(channel, handler);
		},
		onDispose(fn) {
			disposeCallbacks.push(fn);
		},
		registeredHandlers,
		disposeCallbacks,
	};
}

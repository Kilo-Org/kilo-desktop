import type {
	ChannelHandlerInput,
	ChannelHandlerMap,
	ChannelHandlerOutput,
	ChannelMap,
} from "../channel-map.js";

export type { SchemaLike } from "./schema.js";

/**
 * The SDK interface that features (future plugins) program against.
 * Transport-agnostic: sdk.invoke routes to either Electron main or an in-process handler.
 *
 * Obtain an instance in React code via `useSdk(featureId)` — it returns a
 * shared, cached instance per feature that is NOT tied to component
 * lifecycles. See packages/feature-sdk/README.md for the full guide.
 */
export interface SDK {
	readonly featureId: string;

	/**
	 * Call a handler registered by this feature's own mainRegister().
	 * Transport-agnostic: routes through Electron IPC in desktop mode, or
	 * calls the handler directly in-process in browser mode.
	 *
	 * Returns `unknown` at this layer — prefer `withChannels(sdk, channels)` so
	 * channel names, raw args, and parsed return types are inferred from the
	 * feature's channel map. The feature router parses each boundary once.
	 *
	 * @example
	 * const sdk = withChannels(useSdk("todos"), todosChannels);
	 * const todos = await sdk.invoke("list");
	 * const todo = await sdk.invoke("add", { title: "Buy milk" });
	 *
	 * Scoped to this feature only. To call ANOTHER feature, use
	 * `sdk.plugins.get` (capabilities) instead.
	 */
	invoke(channel: string, args?: unknown): Promise<unknown>;

	/** Namespaced event bus — fire-and-forget pub/sub. See {@link SdkEvents}. */
	readonly events: SdkEvents;

	/** Observable reactive state stores. See {@link SdkState}. */
	readonly state: SdkState;

	/** Cross-feature capability exposure and discovery. See {@link SdkPlugins}. */
	readonly plugins: SdkPlugins;

	/**
	 * Register a React component in a named shell zone (status bar,
	 * dashboard, ...). The shell owns where and how zones render.
	 * Use routes, not contributions, for the feature's main view.
	 * Returns an unregister function for conditional UI; contributions are
	 * also cleaned up automatically when this SDK instance is destroyed.
	 *
	 * @example
	 * const remove = sdk.contribute("statusbar", { component: TodoBadge, label: "Todos", priority: 10 });
	 */
	contribute(zone: string, options: ContributionOptions): () => void;

	/** Register commands in the command palette. See {@link SdkCommands}. */
	readonly commands: SdkCommands;

	/** Shell-level services (delegated to the shell). NOTE: fs is not wired yet and rejects; notifications report `delivered: false` until wired. */
	readonly notifications: SdkNotifications;
	readonly theme: SdkTheme;
	readonly shell: SdkShell;
	readonly fs: SdkFs;

	/** Not yet available — requires the full plugin system. Calling these throws. */
	readonly tools: SdkTools;
	readonly intents: SdkIntents;
	navigate(intent: NavigateIntent): void;
	dispatch(intent: DispatchIntent): void;

	/** Register a cleanup function called when this SDK instance is destroyed. */
	onDispose(fn: () => void): void;

	/**
	 * Destroy this SDK instance: unsubscribe its event handlers and remove the
	 * stores, contributions, commands, and capabilities registered THROUGH it.
	 * Does NOT tear down the feature's backend handlers — that is shell-owned
	 * (see teardownFeature) and happens on feature/plugin unload, never on
	 * component unmount. Feature code should not call this.
	 */
	destroy(): void;
}

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget pub/sub for cross-feature notifications.
 *
 * Use when something happened and zero-or-more other features may care; the
 * emitter must not depend on who is listening. Not for request/response
 * (use invoke or capabilities) and not replayed — late subscribers miss
 * earlier emissions (use sdk.state for readable-any-time values).
 *
 * @example
 * // In the todos feature — emits "todos.created" (auto-prefixed)
 * sdk.events.emit("created", { id: todo.id });
 * // In any feature — subscribe with the fully-qualified name
 * const unsub = sdk.events.on("todos.created", (payload) => refresh());
 */
export interface SdkEvents {
	/** Emit an event (auto-prefixed with this featureId: "featureId.event"). */
	emit(event: string, payload?: unknown): void;
	/**
	 * Subscribe to a fully-qualified event ("featureId.event", any feature).
	 * Returns an unsubscribe function. Cleaned up automatically when this
	 * SDK instance is destroyed.
	 */
	on(event: string, handler: (payload: unknown) => void): () => void;
	/** Remove a specific handler. */
	off(event: string, handler: (payload: unknown) => void): void;
}

// ─── State ───────────────────────────────────────────────────────────────────

/** Write handle returned to the store owner by sdk.state.register(). */
export interface StoreHandle<T = unknown> {
	/** Set the value and synchronously notify all subscribers. */
	set(value: T): void;
}

/**
 * Read-only observable store. subscribe() fires synchronously with the
 * current value — compatible with React's useSyncExternalStore:
 *
 * @example
 * function useStore<T>(store: ReadableStore<T>): T {
 *   return useSyncExternalStore(store.subscribe, store.peek, store.peek);
 * }
 */
export interface ReadableStore<T = unknown> {
	subscribe(fn: (value: T) => void): () => void;
	peek(): T;
}

/**
 * Observable shared state, readable by every feature.
 *
 * Use for values other features (or many of your own components) observe
 * over time — counts, selection, status. In-memory and renderer-side only:
 * not persistence, and every set() notifies synchronously, so avoid
 * high-frequency data.
 *
 * @example
 * // Owner side
 * const unread = sdk.state.register("unreadCount", 0);
 * unread.set(5);
 * // Consumer side (any feature)
 * const store = sdk.state.get<number>("todos.unreadCount");
 * const unsub = store.subscribe((v) => setBadge(v ?? 0));
 */
export interface SdkState {
	/** Register a store owned by this feature (key becomes "featureId.storeName"). */
	register<T>(storeName: string, initialValue: T): StoreHandle<T>;
	/**
	 * Look up a store by namespaced key ("featureId.storeName").
	 * The value is T | null because the store may not be registered yet
	 * (lazy resolution): subscribers receive null until it hydrates.
	 */
	get<T = unknown>(namespacedKey: string): ReadableStore<T | null>;
	/** Read a store's current value without subscribing (null if absent). */
	peek(namespacedKey: string): unknown;
	/**
	 * Whether a store has been registered by its owner (hydrated).
	 * False for keys only seen by get() — use this to distinguish "not
	 * loaded yet / typo" from a legitimately null value.
	 */
	has(namespacedKey: string): boolean;
}

// ─── Plugins (capabilities) ──────────────────────────────────────────────────

/**
 * Cross-feature capabilities — the request/response counterpart to events,
 * and the ONLY sanctioned way to call another feature. Never import another
 * feature's source; get() returning null is the contract that keeps
 * features independently loadable.
 *
 * @example
 * // The todos feature exposes an API
 * sdk.plugins.expose("todoService", {
 *   addTodo: (title: string) => sdk.invoke("create", { title }),
 * });
 * // Another feature consumes it — defensively, it may not be loaded
 * const caps = sdk.plugins.get("todos");
 * await (caps?.todoService as TodoService | undefined)?.addTodo("Hi");
 */
export interface SdkPlugins {
	/** Expose a named capability object for other features to consume. */
	expose(capabilityName: string, implementation: Record<string, unknown>): void;
	/**
	 * Get all capabilities exposed by a feature, or null if none/not loaded.
	 * The type parameter is ASSERTED, not validated — it moves the cast out
	 * of call sites, nothing more. Always handle null.
	 *
	 * @example
	 * interface TodoCapabilities { todoService: { addTodo(title: string): Promise<unknown> } }
	 * const caps = sdk.plugins.get<TodoCapabilities>("todos");
	 * await caps?.todoService.addTodo("Hi");
	 */
	get<T extends Record<string, unknown> = Record<string, unknown>>(featureId: string): T | null;
}

// ─── Contributions ───────────────────────────────────────────────────────────

export interface ContributionOptions {
	/** React component to render in the zone. */
	component: unknown;
	label: string;
	size?: string;
	/** Higher priority renders first. Default 0. */
	priority?: number;
}

export interface Contribution {
	featureId: string;
	zone: string;
	component: unknown;
	label: string;
	size?: string;
	priority: number;
}

// ─── Commands ────────────────────────────────────────────────────────────────

export interface CommandDefinition {
	/** Command id — auto-namespaced to "featureId.id" on registration. */
	id: string;
	label: string;
	handler: () => void | Promise<void>;
}

export interface Command {
	id: string;
	featureId: string;
	label: string;
	handler: () => void | Promise<void>;
}

/**
 * Command palette entries.
 *
 * @example
 * sdk.commands.register({ id: "add", label: "Add todo", handler: () => openAddDialog() });
 */
export interface SdkCommands {
	register(definition: CommandDefinition): void;
}

// ─── Shell-level services ────────────────────────────────────────────────────

/** Result envelope for notification delivery. */
export interface NotificationResult {
	delivered: boolean;
	/** Present when delivered is false (e.g., service not wired yet). */
	reason?: string;
}

/**
 * Shell notifications. NOT WIRED YET: calls are safe but report
 * `{ delivered: false, reason }` — check the result if delivery matters,
 * and prefer capability detection over environment branching.
 *
 * @example
 * const result = sdk.notifications.show({ type: "info", title: "Hi", message: "..." });
 * if (!result.delivered) fallbackInlineBanner();
 */
export interface SdkNotifications {
	show(opts: {
		title: string;
		message: string;
		type: "info" | "success" | "warning" | "error";
	}): NotificationResult;
	setBadge(count: number): NotificationResult;
}

/**
 * Effective theme, shell-owned.
 *
 * @example
 * sdk.theme.peek(); // "dark" | "light"
 * const unsub = sdk.theme.subscribe((t) => applyTheme(t)); // fires immediately
 */
export interface SdkTheme {
	/** Subscribe to theme changes. Fires synchronously with the current value. */
	subscribe(fn: (theme: "dark" | "light") => void): () => void;
	/** Read the current effective theme without subscribing. */
	peek(): "dark" | "light";
}

/** OS-level shell actions (open browser, clipboard). */
export interface SdkShell {
	openExternal(url: string): Promise<{ opened: boolean }>;
	copyText(text: string): Promise<void>;
}

/** NOT WIRED YET — calls reject. Do not ship code paths relying on it. */
export interface SdkFs {
	readFile(relativePath: string): Promise<string>;
	writeFile(relativePath: string, content: string): Promise<void>;
	exists(relativePath: string): Promise<boolean>;
	mkdir(relativePath: string): Promise<void>;
	readdir(relativePath: string): Promise<string[]>;
	remove(relativePath: string): Promise<void>;
}

// ─── Deferred (plugin system required) ───────────────────────────────────────

/** NOT AVAILABLE YET — placeholder so the interface shape is stable. Calls throw. */
export interface SdkTools {
	register(definition: unknown): void;
	invoke(featureId: string, toolName: string, args: unknown): Promise<unknown>;
	all(): unknown[];
}

/** NOT AVAILABLE YET — placeholder so the interface shape is stable. Calls throw. */
export interface SdkIntents {
	list(): unknown[];
}

export interface NavigateIntent {
	plugin: string;
	intent: string;
	params?: Record<string, unknown>;
}

export interface DispatchIntent {
	plugin: string;
	action: string;
	params?: Record<string, unknown>;
}

// ─── MainSdk (main-process side) ─────────────────────────────────────────────

/**
 * Typed handler registrar bound to a channel map. Bind once via
 * `mainSdk.channels(map)`, then register each channel — or use `handleAll`
 * so the compiler proves no channel was forgotten.
 */
export interface ChannelHandlers<C extends ChannelMap> {
	handle<K extends keyof C & string>(
		channel: K,
		handler: (
			args: ChannelHandlerInput<C[K]>,
		) => ChannelHandlerOutput<C[K]> | Promise<ChannelHandlerOutput<C[K]>>,
	): void;
	/**
	 * Register a handler for every channel in the map at once. Exhaustive by
	 * construction: adding a channel to the map without a handler here is a
	 * compile error, so it can never fail at invoke time instead.
	 */
	handleAll(handlers: ChannelHandlerMap<C>): void;
}

/**
 * The backend counterpart of the SDK, passed to a feature's mainRegister().
 * Register the handlers that sdk.invoke() calls, and cleanup via onDispose.
 *
 * Bind the feature's channel map once so input/output validation stays aligned
 * with `withChannels` on the renderer.
 *
 * @example
 * export function mainRegister(mainSdk: MainSdk) {
 *   const service = new TodoService();
 *   mainSdk.channels(todosChannels).handleAll({
 *     list: () => service.list(),
 *     add: (input) => service.add(input.title),
 *   });
 *   mainSdk.onDispose(() => service.close());
 * }
 */
export interface MainSdk {
	readonly featureId: string;
	/**
	 * Bind a channel map once, then register typed handlers. Input is parsed
	 * before each handler runs; handler output is parsed before it is returned.
	 * Throw FeatureError for expected failures whose messages should survive
	 * the IPC boundary.
	 */
	channels<C extends ChannelMap>(channels: C): ChannelHandlers<C>;
	/** Cleanup registration — runs when the shell tears the feature down (shutdown, unload). */
	onDispose(fn: () => void): void;
}

// ─── Feature registration ────────────────────────────────────────────────────

/**
 * A feature's entry in the FEATURES array
 * (apps/desktop/src/main/features/registry/features.ts) and, for browser
 * mode, in WEB_FEATURES (apps/web/src/features/features.ts).
 */
export interface FeatureRegistration {
	readonly id: string;
	/**
	 * Main-process handler registration. Runs in Electron main.
	 * May use Node APIs (SQLite, fs, ...).
	 */
	mainRegister(mainSdk: MainSdk): void;
	/**
	 * Browser-mode registration. Standalone browser mode has no main process;
	 * features WITHOUT this are skipped in browser mode (with a warning) —
	 * there is deliberately no fallback to mainRegister, which may use Node
	 * APIs. Node-free features opt in explicitly:
	 *
	 * @example
	 * { id: "todos", mainRegister: register, browserRegister: register }
	 */
	browserRegister?(mainSdk: MainSdk): void;
}

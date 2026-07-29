/**
 * The SDK interface that features (future plugins) program against.
 * Transport-agnostic: sdk.invoke routes to either Electron main or an in-process handler.
 */
export interface SDK {
	readonly featureId: string;

	/**
	 * Invoke a handler registered by this feature's mainRegister().
	 * Transport-agnostic: routes through Electron IPC in desktop mode,
	 * or calls the handler directly in browser mode.
	 */
	invoke(channel: string, args?: unknown): Promise<unknown>;

	/** Namespaced event bus — fire-and-forget pub/sub. */
	readonly events: SdkEvents;

	/** Observable reactive state stores. */
	readonly state: SdkState;

	/** Cross-feature capability exposure and discovery. */
	readonly plugins: SdkPlugins;

	/** Register UI contributions in shell zones. */
	contribute(zone: string, options: ContributionOptions): void;

	/** Register commands in the command palette. */
	readonly commands: SdkCommands;

	/** Shell-level services (delegated to LocalApi). */
	readonly notifications: SdkNotifications;
	readonly theme: SdkTheme;
	readonly shell: SdkShell;
	readonly fs: SdkFs;

	/** Not yet available — requires the full plugin system. */
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
	 * component unmount.
	 */
	destroy(): void;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

/**
 * Minimal structural schema interface (satisfied by Zod schemas).
 * parse() must throw on invalid input and return the parsed value.
 */
export interface SchemaLike<T = unknown> {
	parse(input: unknown): T;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface SdkEvents {
	/** Emit an event (auto-prefixed with featureId). */
	emit(event: string, payload?: unknown): void;
	/** Subscribe to a namespaced event. Returns unsubscribe function. */
	on(event: string, handler: (payload: unknown) => void): () => void;
	/** Remove a specific handler. */
	off(event: string, handler: (payload: unknown) => void): void;
}

// ─── State ───────────────────────────────────────────────────────────────────

export interface StoreHandle<T = unknown> {
	set(value: T): void;
}

export interface ReadableStore<T = unknown> {
	subscribe(fn: (value: T) => void): () => void;
	peek(): T;
}

export interface SdkState {
	register<T>(storeName: string, initialValue: T): StoreHandle<T>;
	/**
	 * Look up a store by namespaced key ("featureId.storeName").
	 * The value is T | null because the store may not be registered yet
	 * (lazy resolution): subscribers receive null until it hydrates.
	 */
	get<T = unknown>(namespacedKey: string): ReadableStore<T | null>;
	peek(namespacedKey: string): unknown;
}

// ─── Plugins (capabilities) ──────────────────────────────────────────────────

export interface SdkPlugins {
	/** Expose a capability for other features to consume. */
	expose(capabilityName: string, implementation: Record<string, unknown>): void;
	/** Get capabilities exposed by another feature. */
	get(featureId: string): Record<string, unknown> | null;
}

// ─── Contributions ───────────────────────────────────────────────────────────

export interface ContributionOptions {
	component: unknown;
	label: string;
	size?: string;
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

export interface SdkCommands {
	register(definition: CommandDefinition): void;
}

// ─── Shell-level services ────────────────────────────────────────────────────

export interface SdkNotifications {
	show(opts: {
		title: string;
		message: string;
		type: "info" | "success" | "warning" | "error";
	}): void;
	setBadge(count: number): void;
}

export interface SdkTheme {
	/** Subscribe to theme changes. Fires synchronously with the current value. */
	subscribe(fn: (theme: "dark" | "light") => void): () => void;
	/** Read the current effective theme without subscribing. */
	peek(): "dark" | "light";
}

export interface SdkShell {
	openExternal(url: string): Promise<{ opened: boolean }>;
	copyText(text: string): Promise<void>;
}

export interface SdkFs {
	readFile(relativePath: string): Promise<string>;
	writeFile(relativePath: string, content: string): Promise<void>;
	exists(relativePath: string): Promise<boolean>;
	mkdir(relativePath: string): Promise<void>;
	readdir(relativePath: string): Promise<string[]>;
	remove(relativePath: string): Promise<void>;
}

// ─── Deferred (plugin system required) ───────────────────────────────────────

export interface SdkTools {
	register(definition: unknown): void;
	invoke(featureId: string, toolName: string, args: unknown): Promise<unknown>;
	all(): unknown[];
}

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

export interface MainSdk {
	readonly featureId: string;
	/**
	 * Register a handler for a channel. Called by the feature's mainRegister().
	 * inputSchema validates args at the routing boundary before the handler
	 * runs (throws FeatureError with code VALIDATION on failure). Pass null
	 * only for channels that take no input.
	 */
	handle<T = unknown>(
		channel: string,
		inputSchema: SchemaLike<T> | null,
		handler: (args: T) => unknown | Promise<unknown>,
	): void;
	/** Cleanup registration — runs when the shell tears the feature down. */
	onDispose(fn: () => void): void;
}

// ─── Feature registration ────────────────────────────────────────────────────

export interface FeatureRegistration {
	readonly id: string;
	/**
	 * Main-process handler registration. Runs in Electron main.
	 * May use Node APIs (SQLite, fs, ...).
	 */
	mainRegister(mainSdk: MainSdk): void;
	/**
	 * Optional browser-mode registration. Standalone browser mode has no main
	 * process; if the feature's mainRegister uses Node APIs it must provide a
	 * browser-safe equivalent here (in-memory fakes). When omitted, browser
	 * mode falls back to mainRegister — only valid for Node-free features.
	 */
	browserRegister?(mainSdk: MainSdk): void;
}

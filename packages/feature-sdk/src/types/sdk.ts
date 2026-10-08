import type {
	ChannelHandlerInput,
	ChannelHandlerMap,
	ChannelHandlerOutput,
	ChannelMap,
} from "../channel-map.js";
import type { ShellZone } from "./zones.js";
import type { SchemaLike } from "./schema.js";

export type { SchemaLike } from "./schema.js";

/**
 * Base type for the proxy client. Features narrow this via
 * `useSdk<MyService>()` where `MyService extends SdkClient`.
 */
export type SdkClient = Record<string, (...args: never[]) => Promise<unknown>>;

/**
 * The SDK interface that features (future plugins) program against.
 * Transport-agnostic: sdk.invoke routes to either Electron main or an in-process handler.
 *
 * Obtain an instance in React code via `useSdk<ServiceType>(featureId)` — it
 * returns a shared, cached instance per feature that is NOT tied to component
 * lifecycles. See packages/feature-sdk/README.md for the full guide.
 */
export interface SDK<T extends SdkClient = SdkClient> {
	readonly featureId: string;

	/**
	 * Call a handler registered by this feature's own mainRegister().
	 * Transport-agnostic: routes through Electron IPC in desktop mode, or
	 * calls the handler directly in-process in browser mode.
	 *
	 * Prefer `sdk.client` for typed method-style access.
	 *
	 * @example
	 * const { client } = useSdk<TodoService>("todos");
	 * const todo = await client.add({ title: "Buy milk" });
	 */
	invoke(channel: string, args?: unknown): Promise<unknown>;

	/**
	 * Proxy client that maps method calls to `invoke(channel, args)`.
	 * Typed via the generic on `useSdk<ServiceType>(featureId)`.
	 *
	 * @example
	 * const { client } = useSdk<TodoService>("todos");
	 * const todo = await client.add({ title: "Buy milk" }); // Todo
	 */
	readonly client: T;

	/** Open a feature-scoped transferable channel to this feature's main process. */
	readonly ports: SdkPorts;

	/** Namespaced event bus — fire-and-forget pub/sub. See {@link SdkEvents}. */
	readonly events: SdkEvents;

	/** Observable reactive state stores. See {@link SdkState}. */
	readonly state: SdkState;

	/** Cross-feature capability exposure and discovery. See {@link SdkPlugins}. */
	readonly plugins: SdkPlugins;

	/**
	 * Register a React component in a named extension zone. The app shell owns
	 * its canonical zones, while plugins may expose shared plugin-owned zones.
	 * Returns an unregister function for conditional UI; contributions are
	 * also cleaned up automatically when this SDK instance is destroyed.
	 *
	 * Any string is accepted; prefer exported zone constants for shared outlets
	 * so a typo cannot silently render nowhere.
	 *
	 * @example
	 * const remove = sdk.contribute("status-bar", { id: "todos", component: TodoBadge, label: "Todos", priority: 10 });
	 */
	contribute(zone: ShellZone | (string & {}), options: ContributionOptions): () => void;

	/** Register commands in the command palette. See {@link SdkCommands}. */
	readonly commands: SdkCommands;

	/** Shell-level services (delegated to the shell). fs is sandboxed per feature — see {@link SdkFs}. */
	readonly notifications: SdkNotifications;
	readonly telemetry: SdkTelemetry;
	readonly theme: SdkTheme;
	readonly auth: SdkAuth;
	readonly featureFlags: SdkFeatureFlags;
	readonly shell: SdkShell;
	readonly fs: SdkFs;
	readonly workspace: SdkWorkspace;

	/**
	 * Navigate the shell router to an absolute path (shell delegate,
	 * Decision #19). The router never leaks to plugins — pass the resolved
	 * path of a plugin route (e.g. "/plugins/todos"), the plugin's own
	 * page path from `PluginPageProps.path`, or any shell path.
	 *
	 * @example
	 * sdk.navigate("/plugins/todos");
	 * sdk.navigate("/plugins/todos", { search: { filter: "open" } });
	 */
	navigate(path: string, options?: NavigateOptions): void;

	/**
	 * Observable current location of the shell router. subscribe() fires
	 * synchronously with the current value; subscriptions made through this
	 * SDK instance are cleaned up on destroy().
	 */
	readonly location: SdkLocation;

	/**
	 * Deferred — no consumer exists yet; calling these throws. See
	 * docs/plugin-implementation-plan.md (Slice 4, "Deferred APIs") for the
	 * rationale and timeline.
	 */
	readonly tools: SdkTools;
	readonly intents: SdkIntents;
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

/** Renderer-side transferable channel API. */
export interface SdkPorts {
	/**
	 * Open a channel handled by this feature's `mainSdk.ports.handle()`.
	 * Electron transfers the returned port without exposing its IPC APIs.
	 * Renderer code normally supplies `MessagePort` as the type parameter;
	 * keeping the core contract generic leaves Node-only plugin builds DOM-free.
	 */
	open<TPort = unknown>(channel: string, args?: unknown): TPort;
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
	/**
	 * Emit an event (auto-prefixed with this featureId: "featureId.event").
	 * Payloads must be structured-cloneable so Electron and browser mode have
	 * the same contract.
	 */
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

export type ContributionMountPolicy = "active-only" | "keep-alive";

export interface ContributionOptions {
	/** Stable identifier within this feature and zone. */
	id: string;
	/** React component to render in the zone. */
	component: unknown;
	label: string;
	/** Optional supporting copy for hosts that present contributions in a picker. */
	description?: string;
	/** Optional React icon component; remains unknown so feature-sdk stays React-free. */
	icon?: unknown;
	/** Hint for hosts that conditionally mount contribution content. */
	mountPolicy?: ContributionMountPolicy;
	size?: string;
	/** Higher priority renders first. Default 0. */
	priority?: number;
}

export interface Contribution {
	id: string;
	featureId: string;
	zone: string;
	component: unknown;
	label: string;
	description?: string;
	icon?: unknown;
	mountPolicy?: ContributionMountPolicy;
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

/**
 * Result envelope for notification delivery. `reason` includes `undefined` to
 * stay structurally identical to the contract's zod-inferred type under
 * `exactOptionalPropertyTypes`.
 */
export interface NotificationResult {
	delivered: boolean;
	/** Present when delivered is false (e.g., unsupported platform, permission denied). */
	reason?: string | undefined;
}

/**
 * Shell notifications, delegated to the host (Electron OS notifications and
 * dock/taskbar badge; browser mode uses the Web Notification/Badging APIs
 * where available). Delivery is best-effort and never throws for expected
 * capability absence: check the result envelope if delivery matters, and
 * prefer capability detection over environment branching.
 *
 * @example
 * const result = await sdk.notifications.show({ type: "info", title: "Hi", message: "..." });
 * if (!result.delivered) fallbackInlineBanner();
 */
export interface SdkNotifications {
	show(opts: {
		title: string;
		message: string;
		type: "info" | "success" | "warning" | "error";
	}): Promise<NotificationResult>;
	setBadge(count: number): Promise<NotificationResult>;
}

/**
 * feature-sdk keeps a LOCAL copy of this shape so it never depends on
 * `contracts` (same rule used for {@link AuthSession}): `event` is typed as
 * `string` here; the closed enum is enforced at the IPC boundary in the main
 * process. Keep in sync with contracts' telemetryTrackInputSchema.
 */
export interface TelemetryData {
	event: string;
	data?: Record<string, unknown>;
	options?: { anonymize?: "always" | "if-not-logged-in" | "never" };
}

/**
 * Product telemetry, shell-owned. Fire-and-forget: track() never rejects for
 * expected drops (browser mode, opt-out). The SDK auto-tags each event with the
 * calling feature's id under `data.featureId` (an explicit data.featureId wins).
 *
 * @example
 * sdk.telemetry.track({ event: "Page Visit", data: { path: "/todos" } });
 */
export interface SdkTelemetry {
	track(input: TelemetryData): Promise<void>;
}

/** Full terminal palette supplied by a named theme. */
export interface TerminalPalette {
	background: string;
	foreground: string;
	cursor: string;
	cursorAccent: string;
	selectionBackground: string;
	selectionForeground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
}

export interface ThemeAppearance {
	mode: "light" | "dark";
	themeId: string;
	/** Null preserves the terminal's built-in palette. */
	terminal: TerminalPalette | null;
	shiki: string;
}

/** Effective theme and appearance, shell-owned. */
export interface SdkTheme {
	/** Fires synchronously, then on appearance changes (even when mode is unchanged). */
	subscribe(fn: () => void): () => void;
	/** Stable snapshot until appearance changes; suitable for useSyncExternalStore. */
	appearance(): ThemeAppearance;
}

/** Map of feature-flag keys to their evaluated values. */
export type FeatureFlagMap = Record<string, unknown>;

/**
 * Feature flags, shell-owned. The delegate keeps a synchronous cache of the
 * flag map: `subscribe` fires immediately with the current cache and `peek`
 * reads it without subscribing (`{}` until the host's first resolve lands).
 * `getAllFlags` still queries the host directly.
 *
 * @example
 * const unsub = sdk.featureFlags.subscribe((flags) => render(flags));
 */
export interface SdkFeatureFlags {
	/** Read the full flag map from the host. */
	getAllFlags(): Promise<FeatureFlagMap>;
	/**
	 * Subscribe to flag changes. Fires synchronously with the current cached
	 * map and again on every host change. Returns an unsubscribe function.
	 */
	subscribe(fn: (flags: FeatureFlagMap) => void): () => void;
	/** Read the current cached flag map without subscribing (`{}` until first resolve). */
	peek(): FeatureFlagMap;
}

export interface DirectoryOpenDialogOptions {
	kind: "directory";
	multiple?: boolean;
}

export interface PaneWindow {
	pluginId: string;
	sessionId: string;
	paneId: string;
	title: string;
	path: string;
	workspaceId?: string | undefined;
}

export type PaneWindowEvent = {
	type: "opened" | "docked" | "focused" | "blurred";
	pluginId: string;
	sessionId: string;
	paneId: string;
};

/** OS-level shell actions (open browser, clipboard, native folder access). */
export interface SdkShell {
	readonly canPickDirectories: boolean;
	readonly canPopOutPanes: boolean;
	readonly windowRole: "main" | "pane";
	openExternal(url: string): Promise<{ opened: boolean }>;
	copyText(text: string): Promise<void>;
	showItemInFolder(path: string): Promise<{ revealed: boolean }>;
	showOpenDialog(
		options: DirectoryOpenDialogOptions,
	): Promise<{ canceled: boolean; paths: string[] }>;
	getPathForFile(file: File): string | null;
	openPaneWindow(input: PaneWindow): Promise<{ opened: boolean }>;
	listPaneWindows(pluginId: string): Promise<PaneWindow[]>;
	focusPaneWindow(
		input: Pick<PaneWindow, "pluginId" | "sessionId" | "paneId">,
	): Promise<{ focused: boolean }>;
	dockPaneWindow(
		input: Pick<PaneWindow, "pluginId" | "sessionId" | "paneId">,
	): Promise<{ docked: boolean }>;
	syncPaneWindows(pluginId: string, activeSessionId: string | null): Promise<void>;
	onPaneWindowChanged(listener: (event: PaneWindowEvent) => void): () => void;
}

// ─── Workspace (file-change subscription) ────────────────────────────────────

/**
 * File-change vocabulary of the workspace watcher. feature-sdk keeps a LOCAL
 * copy of these shapes (same rule as {@link AuthSession}) so it never depends
 * on `contracts`. Keep in sync with contracts' workspace feature schemas.
 */
export type WorkspaceFileChangeType = "create" | "update" | "delete";

export interface WorkspaceFileChange {
	/** Absolute path of the changed file, in platform-native form (backslash-separated on Windows). */
	path: string;
	type: WorkspaceFileChangeType;
}

export interface WorkspaceFileChangeEvent {
	/** Absolute path of the watched directory the batch belongs to. */
	root: string;
	changes: WorkspaceFileChange[];
}

/**
 * Glob + event-type filters applied to each batch before delivery. Globs are
 * picomatch syntax, always authored with forward slashes; matching is
 * separator-insensitive (vscode-style), so they match native Windows event
 * paths. Normalize native absolute paths with `toPosixPath` before escaping
 * and embedding them in a glob.
 */
export interface WorkspaceSubscriptionOptions {
	/** picomatch globs — if set, only matching paths fire. */
	includes?: string[] | undefined;
	/** picomatch globs — matching paths are suppressed. */
	excludes?: string[] | undefined;
	/** Event type filter — if set, only these event types fire. */
	types?: WorkspaceFileChangeType[] | undefined;
}

/**
 * Workspace file-change subscription, shell-owned. Backed by the workspace
 * feature's event bus emission; the filter runs per batch in the SDK, so
 * subscribers only see the changes they asked for.
 *
 * @example
 * const unsub = sdk.workspace.subscribe({ types: ["create"] }, (event) => refresh(event.root));
 */
export interface SdkWorkspace {
	/**
	 * Subscribe to filtered file-change batches. Returns an unsubscribe
	 * function; subscriptions are cleaned up when this SDK instance is
	 * destroyed.
	 */
	subscribe(
		options: WorkspaceSubscriptionOptions,
		callback: (event: WorkspaceFileChangeEvent) => void,
	): () => void;
}

// ─── Auth ─────────────────────────────────────────────────────────────────

/**
 * Anaconda user identity attached to an authenticated session.
 * All fields optional — service accounts may lack a user id or username.
 * Value unions include `undefined` to stay structurally identical to the
 * contract's zod-inferred type under `exactOptionalPropertyTypes`.
 */
export interface AuthUser {
	userId?: string | undefined;
	username?: string | undefined;
	email?: string | undefined;
	firstName?: string | undefined;
	lastName?: string | undefined;
	org?: { id?: string | undefined; name?: string | undefined } | undefined;
}

/**
 * Discriminated-union session state exposed to features. Structurally
 * identical to the contract's `authSessionSchema` inferred type — feature-sdk
 * keeps a LOCAL copy so it never depends on `contracts`. Keep the two in sync.
 */
export type AuthSession =
	| { status: "anonymous" }
	| { status: "authenticated"; user: AuthUser }
	| { status: "error"; reason: string };

/**
 * Anaconda session, shell-owned. Resolved lazily on first read; a logged-in
 * user may briefly observe `anonymous` before the first async resolution lands.
 *
 * @example
 * sdk.auth.peek(); // { status: "anonymous" } until resolved
 * const unsub = sdk.auth.subscribe((s) => render(s)); // fires immediately
 * await sdk.auth.refresh(); // force a re-resolve
 */
export interface SdkAuth {
	/** Subscribe to session changes. Fires synchronously with the current value. */
	subscribe(fn: (session: AuthSession) => void): () => void;
	/** Read the current cached session without subscribing. */
	peek(): AuthSession;
	/** Resolve the session (cached after first call). */
	getSession(): Promise<AuthSession>;
	/** Force a re-resolution of the session. */
	refresh(): Promise<AuthSession>;
	/**
	 * Run the interactive OAuth login flow (opens the system browser),
	 * exchange the token for an API key, persist it, and re-resolve the
	 * session. Resolves with the resulting session; failures resolve to an
	 * `error` session rather than throwing.
	 */
	login(): Promise<AuthSession>;
	/**
	 * Delete the persisted API key and transition to an anonymous session.
	 * Resolves with the resulting session.
	 */
	logout(): Promise<AuthSession>;
}

/**
 * Scoped filesystem access, delegated to the shell (a capability boundary,
 * not raw fs).
 *
 * **Scoping model:** every path is relative to this feature's private sandbox
 * directory — a dedicated `fs/` subdirectory of the Decision #20 storage root,
 * i.e. `${userData}/plugins/<id>/fs/`. That subdir is a sibling of the
 * feature's SQLite `data.db`, never its parent, so `sdk.fs` can never reach
 * the feature's database. The shell rejects absolute paths and any path that
 * escapes the sandbox (`..`); a feature can never see another feature's files
 * or the host filesystem. Expected failures (missing file, escaping path)
 * reject with a descriptive error.
 *
 * Electron-only: browser mode has no filesystem, so calls reject — treat fs
 * as a detectable capability, not a given.
 *
 * @example
 * await sdk.fs.writeFile("settings.json", JSON.stringify(settings));
 * const raw = await sdk.fs.readFile("settings.json");
 */
export interface SdkFs {
	readFile(relativePath: string): Promise<string>;
	writeFile(relativePath: string, content: string): Promise<void>;
	exists(relativePath: string): Promise<boolean>;
	mkdir(relativePath: string): Promise<void>;
	readdir(relativePath: string): Promise<string[]>;
	remove(relativePath: string): Promise<void>;
}

/**
 * Host-side filesystem delegate. The host implements this ONCE for all
 * features; the SDK binds the calling feature's id so `sdk.fs` stays
 * featureId-free. `featureId` selects the sandbox root
 * (`${userData}/plugins/<featureId>/fs/`) — the host must validate it and the
 * relative path (see {@link SdkFs} for the scoping model).
 */
export interface ShellFsDelegate {
	readFile(featureId: string, relativePath: string): Promise<string>;
	writeFile(featureId: string, relativePath: string, content: string): Promise<void>;
	exists(featureId: string, relativePath: string): Promise<boolean>;
	mkdir(featureId: string, relativePath: string): Promise<void>;
	readdir(featureId: string, relativePath: string): Promise<string[]>;
	remove(featureId: string, relativePath: string): Promise<void>;
}

// ─── Navigation (shell delegate) ─────────────────────────────────────────────

/** Snapshot of the shell router's current location. */
export interface ShellLocation {
	/** Current pathname, e.g. "/plugins/todos". */
	path: string;
	/** Parsed search params of the current location. */
	search: Record<string, unknown>;
}

export interface NavigateOptions {
	/** Search params serialized into the destination URL. */
	search?: Record<string, unknown>;
	/** Replace the current history entry instead of pushing a new one. */
	replace?: boolean;
}

/**
 * Read-only observable of the shell router's current location, exposed as
 * `sdk.location`. Mirrors the theme/auth observable contract.
 *
 * @example
 * sdk.location.peek(); // { path: "/plugins/todos", search: {} }
 * const unsub = sdk.location.subscribe((loc) => render(loc)); // fires immediately
 */
export interface SdkLocation {
	/** Subscribe to location changes. Fires synchronously with the current value. */
	subscribe(fn: (location: ShellLocation) => void): () => void;
	/** Read the current location without subscribing. */
	peek(): ShellLocation;
}

/**
 * Shell-owned navigation delegate (Decision #19). The shell implements this
 * over its internal router; plugins consume it as `sdk.navigate` +
 * `sdk.location` and never import the router.
 */
export interface SdkNavigation extends SdkLocation {
	navigate(path: string, options?: NavigateOptions): void;
}

/**
 * Props the shell passes to a plugin's page component when it mounts a route
 * declared in `plugin.json`. Pages may ignore them; use `sdk.location` for a
 * live subscription instead of a render-time snapshot.
 */
export interface PluginPageProps {
	/** The full resolved route path that matched, e.g. "/plugins/todos". */
	path: string;
	/** Parsed search params of the current location. */
	search: Record<string, unknown>;
}

// ─── Tools (AI-runtime tool registry) ────────────────────────────────────────

/**
 * Behaviour hints for an AI runtime, mirroring the MCP / WebMCP tool
 * annotation vocabulary. All optional; consumers treat absence as "unknown".
 */
export interface ToolAnnotations {
	/** Display title distinct from the machine name. */
	title?: string;
	/** The tool only reads state and never mutates. */
	readOnlyHint?: boolean;
	/** The tool may perform destructive/irreversible actions. */
	destructiveHint?: boolean;
	/** Calling repeatedly with the same args has no additional effect. */
	idempotentHint?: boolean;
	/** The tool reaches beyond local state (network, external systems). */
	openWorldHint?: boolean;
}

/** Trusted caller metadata supplied by an AI-runtime adapter, never by tool arguments. */
export interface ToolInvocationContext {
	/** Kilo session that originated the invocation, when the Kilo adapter supplied it. */
	readonly kiloSessionId?: string;
	/** Kilo tool-call id used to correlate concurrent invocations. */
	readonly kiloCallId?: string;
}

/**
 * A tool a feature exposes to an AI runtime (e.g. the WebMCP bridge).
 *
 * `inputSchema` is a JSON Schema object advertised to clients. `validate` is an
 * optional structural validator (satisfied by a Zod schema) run before the
 * handler; when present, the handler receives its parsed output.
 */
export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
	/**
	 * Tool name. Stored in the registry under the namespaced id `featureId.name`
	 * (the `.`-form is the internal key used by `services.toolRegistry.invoke`
	 * and by `RegisteredTool.id`). When published to MCP clients through the
	 * WebMCP bridge, the wire name is sanitized to `featureId_name` because MCP
	 * tool names are restricted to `[A-Za-z0-9_]`. Prefer `[A-Za-z0-9_]`-only
	 * names to avoid the sanitization step and any collision risk.
	 */
	name: string;
	description: string;
	/** JSON Schema (draft 2020-12) describing the arguments object. */
	inputSchema?: Readonly<Record<string, unknown>>;
	/** Optional validator; its parsed value is passed to `handler`. */
	validate?: SchemaLike<TArgs>;
	annotations?: ToolAnnotations;
	/**
	 * Opt-in to serving this tool to AI agents: the bundled Kilo agent and,
	 * while the user allows it, every paired external AI app (which approves
	 * calls itself, without a Desktop prompt). Defaults to `false`: a tool is
	 * registered for in-app use but NOT served to any agent unless it
	 * explicitly opts in. Leave a tool unexposed if agent access is not
	 * intended.
	 */
	exposeToModelContext?: boolean;
	handler: (args: TArgs, context: ToolInvocationContext) => TResult | Promise<TResult>;
}

/** A tool as stored in the registry, with its owning feature and namespaced id. */
export interface RegisteredTool {
	/** Owning feature id. */
	featureId: string;
	/** Namespaced id, "featureId.name" (the registry key). */
	id: string;
	name: string;
	description: string;
	inputSchema?: Readonly<Record<string, unknown>>;
	annotations?: ToolAnnotations;
	/** Whether the tool opted in to being served to AI agents (see ToolDefinition). */
	exposeToModelContext: boolean;
}

/**
 * Feature-registered tools for an AI runtime. Tool names are auto-namespaced by
 * feature id (`featureId.name` internally, `featureId_name` on the MCP wire).
 * The shell's tool catalog publisher reads the registry and subscribes to its
 * change notifications to serve opted-in tools to AI agents.
 *
 * Note there is deliberately no `invoke` on this plugin-facing surface. Tools
 * are the AI adapter over a domain function; plugin code should never
 * round-trip through the adapter to reach code it owns (that pays arg-validation
 * / JSON Schema / CallToolResult overhead for zero benefit). The idiomatic
 * pattern:
 *
 *   1. Write the domain function.
 *   2. Expose it to other plugins via `sdk.plugins.expose(name, impl)`.
 *   3. Optionally adapt it as an AI tool via `sdk.tools.register(...)`, whose
 *      `handler` calls the same domain function.
 *
 * Cross-plugin code calls `sdk.plugins.get<T>("otherFeatureId")?.method(...)`.
 * The only code that ever invokes a tool programmatically is the shell (the
 * WebMCP bridge, on behalf of the AI), and it uses
 * `services.toolRegistry.invoke(featureId, name, args)` — infrastructure, not
 * a plugin API.
 */
export interface SdkTools {
	/** Register one of THIS feature's tools. Returns an unregister function. */
	register(definition: ToolDefinition): () => void;
	/** Read-only metadata for all currently registered tools across features. */
	all(): RegisteredTool[];
}

/**
 * DEFERRED — placeholder so the interface shape is stable. Calls throw.
 * See docs/plugin-implementation-plan.md (Slice 4, "Deferred APIs").
 */
export interface SdkIntents {
	list(): unknown[];
}

export interface DispatchIntent {
	plugin: string;
	action: string;
	params?: Record<string, unknown>;
}

export interface KvStore<T extends Record<string, unknown>> {
	snapshot(): T;
	get<K extends keyof T>(key: K): T[K];
	set(patch: Partial<T>): T;
	clear(): void;
}

export interface KvStoreOptions<T extends Record<string, unknown>> {
	defaults: T;
	namespace?: string;
}

export interface MainSdkStorage {
	kv<T extends Record<string, unknown>>(options: KvStoreOptions<T>): KvStore<T>;
}

export type KvStoreFactory = <T extends Record<string, unknown>>(
	options: KvStoreOptions<T>,
) => KvStore<T>;

// ─── MainSdk (main-process side) ─────────────────────────────────────────────

/** Feature-scoped application logger supplied by the host process. */
export interface MainSdkLogger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
}

/** Host-backed fetch implementation used by main-process features. */
export type MainSdkFetch = typeof globalThis.fetch;

export interface MainSdkNet {
	fetch: MainSdkFetch;
}

/**
 * Boot-time hooks a feature's `mainRegister` may call while the shell is
 * still starting up. Every hook is a no-op after `bootFeatures` returns so
 * a stray late call from an async task never mutates shell UI.
 *
 * @example
 * export function mainRegister(mainSdk: MainSdk) {
 *   mainSdk.boot.reportProgress("Staging conda…");
 *   // ...long-running staging work...
 * }
 */
export interface MainSdkBoot {
	/**
	 * Report a human-readable progress message while this feature is booting.
	 * Delivered to the host's boot-progress channel (e.g. a splash window);
	 * silently dropped once `bootFeatures` has finished so features cannot
	 * accidentally push UI updates after the app has moved on.
	 *
	 * `mainRegister` itself is synchronous, so only messages emitted inline
	 * (before `mainRegister` returns) are guaranteed to be delivered. A
	 * Promise chained off `mainRegister` resolves after `bootFeatures` has
	 * already closed the boot window, and its `reportProgress` calls will
	 * no-op — until `bootFeatures` gains an async boot phase, keep
	 * long-running staging progress inline or accept the loss.
	 */
	reportProgress(message: string): void;
}

/**
 * Electron-free structural subset shared by transferred main-process ports.
 * It intentionally matches MessagePortMain without importing Electron.
 */
export interface HostMessagePort {
	postMessage(message: unknown): void;
	on(event: "message", listener: (event: { data: unknown }) => void): this;
	on(event: "close", listener: () => void): this;
	off(event: "message", listener: (event: { data: unknown }) => void): this;
	off(event: "close", listener: () => void): this;
	start(): void;
	close(): void;
}

export interface HostPortContext {
	/** Electron webContents id of the trusted renderer that transferred the port. */
	readonly senderId: number;
}

export interface MainSdkHostDialogOptions {
	readonly filters?: readonly { readonly name: string; readonly extensions: readonly string[] }[];
	readonly defaultPath?: string;
}

export interface HostBrowserState {
	readonly webContentsId: number;
	readonly url: string;
	readonly title: string;
	readonly faviconUrl: string;
	readonly loading: boolean;
	readonly canGoBack: boolean;
	readonly canGoForward: boolean;
	readonly zoomFactor: number;
	readonly failure?: {
		readonly code: number;
		readonly description: string;
	};
}

export interface HostBrowserController {
	readonly webContentsId: number;
	navigate(url: string): Promise<void>;
	goBack(): void;
	goForward(): void;
	reload(): void;
	hardReload(): void;
	zoomIn(): void;
	zoomOut(): void;
	resetZoom(): void;
	openDevTools(): void;
	dispose(): void;
}

export interface MainSdkHostBrowser {
	readonly partition: string;
	initialize(): void;
	attach(webContentsId: number, onState: (state: HostBrowserState) => void): HostBrowserController;
}

/** Narrow shell-owned desktop capabilities available to main-process plugins. */
export interface MainSdkHost {
	readonly paths: {
		defaultSaveDirectory(): string;
		/** OS temp directory for short-lived files (Electron `app.getPath("temp")`). */
		tempDirectory(): string;
	};
	readonly dialog: {
		openFile(senderId: number, options?: MainSdkHostDialogOptions): Promise<string | null>;
		saveFile(senderId: number, options?: MainSdkHostDialogOptions): Promise<string | null>;
	};
	readonly externalLinks: {
		open(url: string): Promise<boolean>;
	};
	readonly window: {
		getTitle(senderId: number): string;
		setTitle(senderId: number, title: string): void;
		isFocused(senderId: number): boolean;
		onFocusChange(senderId: number, listener: (focused: boolean) => void): () => void;
	};
	readonly browser?: MainSdkHostBrowser;
}

export interface MainSdkPorts {
	handle<TArgs>(
		channel: string,
		argsSchema: SchemaLike<TArgs>,
		handler: (port: HostMessagePort, args: TArgs, context: HostPortContext) => void | Promise<void>,
	): void;
}

/**
 * Shell-owned custom protocol delegate. Schemes are declared statically via
 * the plugin manifest's `protocols` array — the shell registers declared
 * schemes as privileged before app-ready (scheme privileges cannot be
 * granted later) and rejects `handle` calls for schemes the plugin did not
 * declare.
 *
 * One handler per scheme: a second `handle` call for the same scheme
 * replaces the first. A registered handler stays bound for the process
 * lifetime — the shell unregisters schemes only at app shutdown
 * (`unregisterAllFeatureSchemes`), not on feature teardown, so a feature
 * whose `mainRegister` throws after a `handle()` call leaves its scheme
 * bound until the process exits. Absent in browser and headless hosts —
 * same optionality as {@link MainSdkHost}.
 */
export interface MainSdkProtocol {
	handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void;
}

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
 * with `sdk.client` on the renderer.
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
	/** Feature-scoped host logger (Electron uses electron-log). */
	readonly logger: MainSdkLogger;
	/** Host networking delegate (Electron uses net.fetch). */
	readonly net: MainSdkNet;
	/** Cross-process, namespaced events. Emissions are prefixed with featureId. */
	readonly events: Pick<SdkEvents, "emit" | "on">;
	/** Main-process cross-feature capability exposure and discovery. */
	readonly plugins: SdkPlugins;
	/**
	 * Boot-time hooks. Only meaningful during `mainRegister`; after
	 * `bootFeatures` returns every hook becomes a no-op so features that
	 * spawn async work cannot push stale progress updates into shell UI.
	 */
	readonly boot: MainSdkBoot;
	/** Register feature-owned handlers for transferred MessagePorts. */
	readonly ports: MainSdkPorts;
	/** Shell-owned desktop capabilities. Absent in browser and headless hosts. */
	readonly host: MainSdkHost | undefined;
	/** Custom protocol delegate (manifest-declared schemes). Absent in browser and headless hosts. */
	readonly protocol: MainSdkProtocol | undefined;
	/**
	 * Shell-provided per-feature data directory (`${userData}/plugins/<id>/`),
	 * created lazily on first access. Features persist ONLY here — open your
	 * own SQLite file (`data.db`) instead of sharing a shell database.
	 * Accessing it in an environment without storage (browser mode) throws;
	 * Node-free features simply never touch it.
	 */
	readonly storageDir: string;
	/** Typed, feature-scoped key/value storage supplied by the host. */
	readonly storage: MainSdkStorage;
	/**
	 * Resolve a static asset shipped inside this plugin's package to an
	 * absolute filesystem path (e.g. `mainSdk.resolvePluginAsset("drizzle")`
	 * for a drizzle migrations folder, or `"seeds/en.json"` for seed data).
	 *
	 * The shell owns the "which layout am I in" question — plugins do NOT
	 * branch on packaged vs source vs test. The shell resolves the asset
	 * against the plugin package it discovered at boot; missing assets throw
	 * with the searched path so failures surface immediately instead of
	 * downstream (e.g. drizzle's "Can't find meta/_journal.json").
	 *
	 * Throws in environments without a plugin directory (built-in features
	 * that ship no assets; browser mode); features that never call it are
	 * unaffected.
	 */
	resolvePluginAsset(subpath: string): string;
	/**
	 * Bind a channel map once, then register typed handlers. Input is parsed
	 * before each handler runs; handler output is parsed before it is returned.
	 * Throw FeatureError for expected failures whose messages should survive
	 * the IPC boundary.
	 */
	channels<C extends ChannelMap>(channels: C): ChannelHandlers<C>;
	/** Cleanup registration — runs when the shell tears the feature down (shutdown, unload). */
	/** Register cleanup that may be asynchronous during host-owned feature teardown. */
	onDispose(fn: () => unknown): void;
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
	 *
	 * May return a Promise for features that need async boot work (e.g.
	 * staging a runtime). `bootFeatures` awaits the returned Promise before
	 * moving to the next feature, keeping boot progress delivery alive
	 * throughout the async phase.
	 */
	mainRegister(mainSdk: MainSdk): void | Promise<void>;
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
	/**
	 * Renderer-side setup that runs at boot in BOTH modes (browser and Electron),
	 * unlike {@link browserRegister} which only fires in browser mode. Receives
	 * the full renderer {@link SDK} — including `sdk.tools` — so a plugin can
	 * own its own WebMCP tool registration (see issue #74) instead of the shell
	 * reaching in through `system.getSdk(id).tools.register(...)`. Handlers may
	 * call `sdk.invoke(...)`: in Electron mode this routes to the main-process
	 * handlers registered by `mainRegister`; in browser mode it resolves
	 * in-process via `browserRegister`.
	 *
	 * @example
	 * export function webRegister(sdk: SDK) {
	 *   sdk.tools.register({
	 *     name: "list", description: "...", exposeToModelContext: true,
	 *     handler: () => sdk.invoke("list"),
	 *   });
	 * }
	 */
	webRegister?(sdk: SDK): void;
	/**
	 * Resolve a subpath inside the plugin's installed package to an absolute
	 * filesystem path. Populated by the loader for plugin registrations
	 * (threaded through from `BundledPlugin.resolveAsset`); undefined for
	 * built-in feature registrations from the FEATURES / WEB_FEATURES arrays.
	 * Backs `mainSdk.resolvePluginAsset`.
	 */
	resolveAsset?: (subpath: string) => string;
}

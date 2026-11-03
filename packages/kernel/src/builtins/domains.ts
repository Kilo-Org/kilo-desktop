import { z } from "zod";

import { defineDomain, method } from "../domain";

const nothing = z.undefined();

export const APP_PHASES = ["starting", "started", "ready", "stopping", "stopped"] as const;
export type AppPhase = (typeof APP_PHASES)[number];

/** Application lifecycle: `starting → started → ready → stopping → stopped`. */
export const KernelApp = defineDomain({
	id: "kernel/app",
	home: "main",
	state: z.object({
		phase: z.enum(APP_PHASES),
		safeMode: z.boolean(),
		version: z.string(),
		platform: z.enum(["mac", "windows", "linux"]),
		/** Origins the app's windows load from, e.g. for a local server's CORS allowlist. */
		rendererOrigins: z.array(z.string()),
	}),
	methods: {
		quit: method(nothing, nothing),
		relaunch: method(z.object({ safeMode: z.boolean().optional() }), nothing),
		/** The app URL the app was launched with (or opened before the window showed), once. */
		takeLaunchUrl: method(nothing, z.string().nullable()),
	},
	events: {
		"phase-changed": z.object({ phase: z.enum(APP_PHASES) }),
		/** An app URL (`<scheme>://…`) was opened while the app was running. */
		"url-opened": z.object({ url: z.string() }),
	},
});

export const PLUGIN_STATES = [
	"resolved",
	"unresolved",
	"activating",
	"active",
	"deactivating",
	"failed",
	"disabled",
] as const;

const issueSchema = z.object({
	severity: z.enum(["error", "warning"]),
	code: z.string(),
	message: z.string(),
	pluginId: z.string().optional(),
});

/**
 * Plugin states and issues in the main process, and which plugins the user
 * turned off. Turning a plugin on or off applies from the next launch (a
 * plugin off for this launch has state `disabled`) and needs the `plugins`
 * permission.
 */
export const KernelPlugins = defineDomain({
	id: "kernel/plugins",
	home: "main",
	permission: "plugins",
	state: z.object({
		plugins: z.record(
			z.string(),
			z.object({
				displayName: z.string(),
				version: z.string(),
				state: z.enum(PLUGIN_STATES),
			}),
		),
		issues: z.array(issueSchema),
		/** Plugins turned off from the next launch. */
		disabled: z.array(z.string()),
	}),
	methods: {
		setEnabled: method(z.object({ pluginId: z.string(), enabled: z.boolean() }), nothing),
		/** Replaces the whole list, e.g. `[]` turns every plugin on. */
		setDisabled: method(z.object({ pluginIds: z.array(z.string()) }), nothing),
	},
	events: {
		"state-changed": z.object({ pluginId: z.string(), state: z.enum(PLUGIN_STATES) }),
	},
	lookup: (state, id) => state.plugins[id],
});

export const SERVICE_STATUSES = [
	"idle",
	"starting",
	"ready",
	"completed",
	"restarting",
	"stopping",
	"stopped",
	"failed",
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const serviceRecordSchema = z.object({
	pluginId: z.string(),
	title: z.string(),
	kind: z.enum(["daemon", "task"]),
	status: z.enum(SERVICE_STATUSES),
	progress: z.string().optional(),
	error: z.string().optional(),
	restarts: z.number().int().min(0),
});
export type ServiceRecord = z.output<typeof serviceRecordSchema>;

/** Supervised services, keyed by contribution key (`<plugin>/<service>`). */
export const KernelServices = defineDomain({
	id: "kernel/services",
	home: "main",
	state: z.object({ services: z.record(z.string(), serviceRecordSchema) }),
	methods: {
		ensureStarted: method(z.object({ key: z.string() }), nothing),
		restart: method(z.object({ key: z.string() }), nothing),
	},
	events: {
		"status-changed": z.object({ key: z.string(), status: z.enum(SERVICE_STATUSES) }),
	},
	lookup: (state, id) => state.services[id],
});

/** Which main-process domain objects are currently provided. */
export const KernelDomains = defineDomain({
	id: "kernel/domains",
	home: "main",
	state: z.object({ provided: z.array(z.string()) }),
	events: {
		provided: z.object({ id: z.string() }),
		withdrawn: z.object({ id: z.string() }),
	},
});

/** Announces contribution changes in the main process. */
export const KernelExtensions = defineDomain({
	id: "kernel/extensions",
	home: "main",
	state: z.object({}),
	events: {
		"contributions-changed": z.object({ pointId: z.string() }),
	},
});

const windowRecord = z.object({
	role: z.enum(["main", "secondary"]),
	view: z.string().optional(),
	/** What the view was opened with. */
	params: z.record(z.string(), z.string()),
	/** The opener's identity for the window (e.g. a pane); opening the same key again shows it. */
	key: z.string().optional(),
	focused: z.boolean(),
	hidden: z.boolean(),
});

/**
 * Windows. Opening and focusing need the `windows` permission. A window
 * opened with a `key` is one per view and key: opening it again shows the
 * existing window instead.
 */
export const KernelWindows = defineDomain({
	id: "kernel/windows",
	home: "main",
	permission: "windows",
	state: z.object({ windows: z.record(z.string(), windowRecord) }),
	methods: {
		open: method(
			z.object({
				view: z.string(),
				params: z.record(z.string(), z.string()).optional(),
				key: z.string().min(1).optional(),
				/** Overrides the view's title, e.g. with what the window shows. */
				title: z.string().min(1).optional(),
				width: z.number().int().positive().optional(),
				height: z.number().int().positive().optional(),
			}),
			z.object({ windowId: z.string(), opened: z.boolean() }),
		),
		focus: method(z.object({ windowId: z.string() }), nothing),
		close: method(z.object({ windowId: z.string() }), nothing),
		/** Hides or shows a secondary window without closing it. */
		setHidden: method(z.object({ windowId: z.string(), hidden: z.boolean() }), nothing),
		focusMain: method(nothing, nothing),
	},
	events: {
		opened: z.object({ windowId: z.string() }),
		focused: z.object({ windowId: z.string() }),
		blurred: z.object({ windowId: z.string() }),
		closed: z.object({ windowId: z.string() }),
	},
	lookup: (state, id) => state.windows[id],
});

/** Operating-system state. */
export const KernelSystem = defineDomain({
	id: "kernel/system",
	home: "main",
	state: z.object({
		online: z.boolean(),
		appearance: z.enum(["light", "dark"]),
		appFocused: z.boolean(),
		suspended: z.boolean(),
	}),
	events: {
		suspend: nothing,
		resume: nothing,
		online: nothing,
		offline: nothing,
		"appearance-changed": z.object({ appearance: z.enum(["light", "dark"]) }),
		"app-focused": nothing,
		"app-blurred": nothing,
	},
});

/** User keybinding overrides by command key; `null` unbinds. */
export const KernelKeybindings = defineDomain({
	id: "kernel/keybindings",
	home: "main",
	state: z.object({ overrides: z.record(z.string(), z.string().nullable()) }),
	methods: {
		setOverride: method(z.object({ command: z.string(), chord: z.string().nullable() }), nothing),
		reset: method(z.object({ command: z.string() }), nothing),
		resetAll: method(nothing, nothing),
	},
});

// --- Host primitives (implemented by the host, gated by permissions) ---

const chromeColors = z.object({ background: z.string(), foreground: z.string() });

/** The OS-level colour scheme and native window chrome. Needs the `appearance` permission. */
export const KernelNativeTheme = defineDomain({
	id: "kernel/native-theme",
	home: "main",
	permission: "appearance",
	state: z.object({
		source: z.enum(["system", "light", "dark"]),
		shouldUseDarkColors: z.boolean(),
	}),
	methods: {
		setSource: method(z.object({ source: z.enum(["system", "light", "dark"]) }), nothing),
		/** Title bar and window background colours for each scheme. */
		setChrome: method(z.object({ light: chromeColors, dark: chromeColors }), nothing),
	},
});

export const KernelDialogs = defineDomain({
	id: "kernel/dialogs",
	home: "main",
	permission: "dialogs",
	state: z.object({}),
	methods: {
		open: method(
			z.object({
				title: z.string().optional(),
				directory: z.boolean().optional(),
				multiple: z.boolean().optional(),
				defaultPath: z.string().optional(),
				filters: z
					.array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
					.optional(),
			}),
			z.object({ paths: z.array(z.string()) }),
		),
		save: method(
			z.object({
				title: z.string().optional(),
				defaultPath: z.string().optional(),
				filters: z
					.array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
					.optional(),
			}),
			z.object({ path: z.string().nullable() }),
		),
		message: method(
			z.object({
				type: z.enum(["none", "info", "warning", "error", "question"]).optional(),
				message: z.string(),
				detail: z.string().optional(),
				buttons: z.array(z.string()).min(1),
				defaultId: z.number().int().optional(),
				cancelId: z.number().int().optional(),
			}),
			z.object({ response: z.number().int() }),
		),
	},
});

export const KernelClipboard = defineDomain({
	id: "kernel/clipboard",
	home: "main",
	permission: "clipboard",
	state: z.object({}),
	methods: {
		writeText: method(z.object({ text: z.string() }), nothing),
	},
});

export const KernelShell = defineDomain({
	id: "kernel/shell",
	home: "main",
	permission: "shell",
	state: z.object({}),
	methods: {
		openExternal: method(z.object({ url: z.string() }), z.boolean()),
		showItemInFolder: method(z.object({ path: z.string() }), nothing),
		/** Reveals the application log file in the OS file manager. */
		showLogs: method(nothing, z.object({ revealed: z.boolean() })),
		logFilePath: method(nothing, z.string()),
	},
});

export const KernelNotifications = defineDomain({
	id: "kernel/notifications",
	home: "main",
	permission: "notifications",
	state: z.object({}),
	methods: {
		show: method(
			z.object({ title: z.string(), body: z.string().optional(), silent: z.boolean().optional() }),
			z.object({ delivered: z.boolean() }),
		),
		setBadge: method(z.object({ count: z.number().int().min(0) }), nothing),
	},
});

const menuItem = z.object({ command: z.string(), group: z.string() });

/** Native app menu entries, each referencing a command. Items are scoped to the calling plugin. */
export const KernelAppMenu = defineDomain({
	id: "kernel/app-menu",
	home: "main",
	permission: "app-menu",
	state: z.object({ items: z.record(z.string(), z.array(menuItem)) }),
	methods: {
		setItems: method(z.object({ items: z.array(menuItem) }), nothing),
	},
});

/**
 * Secrets in the OS keychain, namespaced by the calling plugin. Main-process
 * callers only: a window can't prove which plugin it is.
 */
export const KernelKeychain = defineDomain({
	id: "kernel/keychain",
	home: "main",
	permission: "keychain",
	homeCallersOnly: true,
	state: z.object({}),
	methods: {
		get: method(z.object({ key: z.string() }), z.string().nullable()),
		set: method(z.object({ key: z.string(), value: z.string() }), nothing),
		delete: method(z.object({ key: z.string() }), nothing),
	},
});

const updaterState = z.object({
	enabled: z.boolean(),
	status: z.string(),
	track: z.string(),
	currentVersion: z.string(),
	availableVersion: z.string().nullable(),
	downloadedVersion: z.string().nullable(),
	message: z.string().nullable(),
	checkedAt: z.string().nullable(),
	releaseNotes: z.array(z.unknown()),
});

/** Whether the updater took the request, and its state afterwards. */
const updaterActionResult = z.object({ accepted: z.boolean(), state: updaterState });

export const KernelUpdater = defineDomain({
	id: "kernel/updater",
	home: "main",
	permission: "updater",
	state: updaterState,
	methods: {
		check: method(nothing, updaterActionResult),
		install: method(nothing, updaterActionResult),
		setTrack: method(z.object({ track: z.string() }), updaterActionResult),
	},
});

/**
 * Consent to collect usage data and crash reports. Owned by the host because
 * crash reporting starts before any plugin. `choice` is what the user saved;
 * `allowed` is what every sink must enforce (a build can force it off).
 * Changing the choice needs the `data-collection` permission.
 */
export const KernelDataCollection = defineDomain({
	id: "kernel/data-collection",
	home: "main",
	permission: "data-collection",
	state: z.object({
		choice: z.boolean(),
		allowed: z.boolean(),
		/** Stable, anonymous id of this installation. */
		installationId: z.string(),
		/** Release environment reported with data: `stable`, `preview` or `development`. */
		environment: z.string(),
	}),
	methods: {
		setChoice: method(z.object({ allowed: z.boolean() }), nothing),
	},
});

export const KERNEL_DOMAINS = [
	KernelApp,
	KernelPlugins,
	KernelServices,
	KernelDomains,
	KernelExtensions,
	KernelWindows,
	KernelSystem,
	KernelKeybindings,
	KernelNativeTheme,
	KernelDialogs,
	KernelClipboard,
	KernelShell,
	KernelNotifications,
	KernelAppMenu,
	KernelKeychain,
	KernelUpdater,
	KernelDataCollection,
];

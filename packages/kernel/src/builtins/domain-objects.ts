import { z } from "zod";

import { defineDomainObject, method } from "../domain-object";
import { defineObjectType } from "../object-type";

const nothing = z.undefined();

export const APP_PHASES = ["starting", "started", "ready", "stopping", "stopped"] as const;
export type AppPhase = (typeof APP_PHASES)[number];

/** Application lifecycle: `starting → started → ready → stopping → stopped`. */
export const KernelApp = defineDomainObject({
	id: "kernel/app",
	home: "main",
	description: "The app's lifecycle phase and URLs opened in it.",
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
	"inactive",
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
export const KernelPlugins = defineDomainObject({
	id: "kernel/plugins",
	home: "main",
	description: "Every installed plugin, its state and whether it is enabled.",
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
	/** Local diagnostic text from the last failure (`KernelError.detail`), such as a process's output. */
	detail: z.string().optional(),
	restarts: z.number().int().min(0),
});
export type ServiceRecord = z.output<typeof serviceRecordSchema>;

/** Supervised services, keyed by contribution key (`<plugin>/<service>`). */
export const KernelServices = defineDomainObject({
	id: "kernel/services",
	home: "main",
	description: "Supervised services: status, progress, start and restart.",
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

const domainObjectRecord = z.object({
	owner: z.string(),
	home: z.enum(["main", "renderer"]),
	description: z.string().optional(),
	/** The object type it resolves, for a collection. */
	objectType: z.string().optional(),
	/** Whether its provider is up; a renderer-home domain object is never provided in main. */
	provided: z.boolean(),
});

/** Every domain object the installed plugins define, by id, and whether main provides it now. */
export const KernelDomainObjects = defineDomainObject({
	id: "kernel/domain-objects",
	home: "main",
	description: "Every defined domain object and whether it is provided.",
	state: z.object({ domainObjects: z.record(z.string(), domainObjectRecord) }),
	events: {
		provided: z.object({ id: z.string() }),
		withdrawn: z.object({ id: z.string() }),
	},
	lookup: (state, id) => state.domainObjects[id],
});

const extensionPointRecord = z.object({
	owner: z.string(),
	kind: z.enum(["additive", "exclusive", "decision"]),
	description: z.string().optional(),
});

/** Every extension point, by id, and announcements of contribution changes in main. */
export const KernelExtensions = defineDomainObject({
	id: "kernel/extensions",
	home: "main",
	description: "Every extension point and changes to its contributions.",
	state: z.object({ extensionPoints: z.record(z.string(), extensionPointRecord) }),
	events: {
		"contributions-changed": z.object({ extensionPointId: z.string() }),
	},
	lookup: (state, id) => state.extensionPoints[id],
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

/** One of the app's windows, resolved by `kernel/windows`. */
export const KernelWindow = defineObjectType({
	id: "kernel/window",
	description: "One of the app's windows.",
});

/**
 * Windows. Opening and focusing need the `windows` permission. A window
 * opened with a `key` is one per view and key: opening it again shows the
 * existing window instead.
 */
export const KernelWindows = defineDomainObject({
	id: "kernel/windows",
	home: "main",
	description: "The app's windows: open, focus, close and their events.",
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
	objectType: KernelWindow,
});

/** Operating-system state. */
export const KernelSystem = defineDomainObject({
	id: "kernel/system",
	home: "main",
	description: "Operating-system state: sleep, network, appearance and app focus.",
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
export const KernelKeybindings = defineDomainObject({
	id: "kernel/keybindings",
	home: "main",
	description: "The user's keybinding overrides by command.",
	state: z.object({ overrides: z.record(z.string(), z.string().nullable()) }),
	/** The override for a command, `null` when unbound; `undefined` (absent) when not overridden. */
	lookup: (state, command) => state.overrides[command],
	methods: {
		setOverride: method(z.object({ command: z.string(), chord: z.string().nullable() }), nothing),
		reset: method(z.object({ command: z.string() }), nothing),
		/** Several overrides set and reset as one change, so no half-applied state is ever seen. */
		update: method(
			z.object({
				set: z.record(z.string(), z.string().nullable()),
				reset: z.array(z.string()),
			}),
			nothing,
		),
		resetAll: method(nothing, nothing),
	},
});

// --- Host primitives (implemented by the host, gated by permissions) ---

const chromeColors = z.object({ background: z.string(), foreground: z.string() });

/** The OS-level colour scheme and native window chrome. Needs the `appearance` permission. */
export const KernelNativeTheme = defineDomainObject({
	id: "kernel/native-theme",
	home: "main",
	description: "The OS colour scheme and native window chrome.",
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

export const KernelDialogs = defineDomainObject({
	id: "kernel/dialogs",
	home: "main",
	description: "Native open, save and message dialogs.",
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

export const KernelClipboard = defineDomainObject({
	id: "kernel/clipboard",
	home: "main",
	description: "The system clipboard.",
	permission: "clipboard",
	state: z.object({}),
	methods: {
		writeText: method(z.object({ text: z.string() }), nothing),
	},
});

/** Hands things to the OS: URLs to the browser, files and logs to the file manager. */
export const KernelOs = defineDomainObject({
	id: "kernel/os",
	home: "main",
	description: "Hands URLs, files and logs to the OS.",
	permission: "os",
	state: z.object({}),
	methods: {
		openExternal: method(z.object({ url: z.string() }), z.boolean()),
		showItemInFolder: method(z.object({ path: z.string() }), nothing),
		/** Reveals the application log file in the OS file manager. */
		showLogs: method(nothing, z.object({ revealed: z.boolean() })),
		logFilePath: method(nothing, z.string()),
	},
});

export const KernelNotifications = defineDomainObject({
	id: "kernel/notifications",
	home: "main",
	description: "OS notifications and the app badge.",
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

/**
 * The OS actions a native menu may carry. Developer tools and reload are
 * deliberately absent: no plugin can put them in the menu.
 */
export const APP_MENU_ROLES = [
	"about",
	"services",
	"hide",
	"hideOthers",
	"unhide",
	"quit",
	"undo",
	"redo",
	"cut",
	"copy",
	"paste",
	"pasteAndMatchStyle",
	"delete",
	"selectAll",
	"resetZoom",
	"zoomIn",
	"zoomOut",
	"togglefullscreen",
	"minimize",
	"zoom",
	"front",
	"close",
] as const;
export type AppMenuRole = (typeof APP_MENU_ROLES)[number];

export type AppMenuNode =
	| { readonly type: "submenu"; readonly label: string; readonly items: readonly AppMenuNode[] }
	/** Runs a `kernel/command`; its title and current shortcut are filled in by the host. */
	| {
			readonly type: "command";
			readonly command: string;
			readonly label?: string | undefined;
			readonly enabled?: boolean | undefined;
	  }
	/** An OS action; `chord` (canonical, as `serializeChord`) replaces its default shortcut. */
	| { readonly type: "role"; readonly role: AppMenuRole; readonly chord?: string | undefined }
	| { readonly type: "separator" };

const appMenuNode: z.ZodType<AppMenuNode> = z.lazy(() =>
	z.discriminatedUnion("type", [
		z.object({ type: z.literal("submenu"), label: z.string().min(1), items: z.array(appMenuNode) }),
		z.object({
			type: z.literal("command"),
			command: z.string().min(1),
			label: z.string().min(1).optional(),
			enabled: z.boolean().optional(),
		}),
		z.object({
			type: z.literal("role"),
			role: z.enum(APP_MENU_ROLES),
			chord: z.string().min(1).optional(),
		}),
		z.object({ type: z.literal("separator") }),
	]),
);

/**
 * The native app menu of the calling window: a whole tree of submenus,
 * commands, OS roles and separators. Called from a window (the caller's
 * window is the one whose menu is set); the menu of the focused window is
 * shown, and the host's minimal menu until a window sets one.
 */
export const KernelAppMenu = defineDomainObject({
	id: "kernel/app-menu",
	home: "main",
	description: "The native app menu of the calling window.",
	permission: "app-menu",
	state: z.object({}),
	methods: {
		setMenu: method(z.object({ menus: z.array(appMenuNode) }), nothing),
	},
});

/**
 * Secrets in the OS keychain, namespaced by the calling plugin. Main-process
 * callers only: a window can't prove which plugin it is.
 */
export const KernelKeychain = defineDomainObject({
	id: "kernel/keychain",
	home: "main",
	description: "Secrets in the OS keychain.",
	permission: "keychain",
	homeCallersOnly: true,
	state: z.object({}),
	methods: {
		get: method(z.object({ key: z.string() }), z.string().nullable()),
		set: method(z.object({ key: z.string(), value: z.string() }), nothing),
		delete: method(z.object({ key: z.string() }), nothing),
	},
});

export const UPDATER_STATUSES = [
	"disabled",
	"idle",
	"checking",
	"downloading",
	"downloaded",
	/** A newer version exists but must be downloaded and installed by hand (`downloadUrl`). */
	"available",
	"up-to-date",
	"error",
] as const;
export type UpdaterStatus = (typeof UPDATER_STATUSES)[number];

/** The notes of one release, newest first in `releaseNotes`. */
export const releaseNotesSchema = z.object({
	version: z.string().min(1),
	previousVersion: z.string().min(1).nullable().optional(),
	title: z.string().min(1),
	/** ISO date-time. */
	publishedAt: z.string().min(1),
	bodyMarkdown: z.string(),
	items: z.array(z.string().min(1)),
});
export type ReleaseNotes = z.output<typeof releaseNotesSchema>;

export const updaterStateSchema = z.object({
	/** False where the app can't check for updates (unpackaged, unsupported platform). */
	enabled: z.boolean(),
	status: z.enum(UPDATER_STATUSES),
	/** The release track the app follows, e.g. `stable` or `preview`. */
	track: z.string().min(1),
	/**
	 * The track the running build was published on. Differs from `track` after
	 * a switch until an update from the new track is installed.
	 */
	installedTrack: z.string().min(1),
	currentVersion: z.string(),
	availableVersion: z.string().nullable(),
	downloadedVersion: z.string().nullable(),
	/** Where to get `availableVersion` while the status is `available`. */
	downloadUrl: z.string().nullable(),
	/** What went wrong, or why updating is disabled. */
	message: z.string().nullable(),
	/** ISO date-time of the last check. */
	checkedAt: z.string().nullable(),
	/** Notes of the releases between the current and the downloaded version, newest first. */
	releaseNotes: z.array(releaseNotesSchema),
});
export type UpdaterState = z.output<typeof updaterStateSchema>;

/** Whether the updater took the request, and its state afterwards. */
const updaterActionResult = z.object({ accepted: z.boolean(), state: updaterStateSchema });

export const KernelUpdater = defineDomainObject({
	id: "kernel/updater",
	home: "main",
	description: "App updates: check, download and install.",
	permission: "updater",
	state: updaterStateSchema,
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
export const KernelDataCollection = defineDomainObject({
	id: "kernel/data-collection",
	home: "main",
	description: "The user's consent to collect data.",
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

export const KERNEL_DOMAIN_OBJECTS = [
	KernelApp,
	KernelPlugins,
	KernelServices,
	KernelDomainObjects,
	KernelExtensions,
	KernelWindows,
	KernelSystem,
	KernelKeybindings,
	KernelNativeTheme,
	KernelDialogs,
	KernelClipboard,
	KernelOs,
	KernelNotifications,
	KernelAppMenu,
	KernelKeychain,
	KernelUpdater,
	KernelDataCollection,
];

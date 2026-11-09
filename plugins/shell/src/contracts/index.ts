import type { ComponentType, ReactNode } from "react";
import { z } from "zod";

import {
	defineDomain,
	defineExtensionPoint,
	implementation,
	method,
	whenSchema,
} from "@kilo-desktop/kernel";
import { DEFAULT_APP_THEME_PREFERENCES } from "@kilo-desktop/ui/themes/app-themes";
import type { TerminalPalette } from "@kilo-desktop/ui/themes/appearance-types";
import {
	DEFAULT_TEXT_SIZES,
	THEME_SOURCES,
	type ThemeSource,
} from "@kilo-desktop/ui/themes/theme-tokens";

/**
 * kilo.shell's public surface: the window frame's extension points and the
 * domain objects other plugins use (appearance, theme, navigation).
 *
 * The frame's regions are named by where they are, `<region>-<slot>`: the
 * main area, the left sidebar (body, account entry, notices), the status bar.
 * Points that aren't places (settings, onboarding, deep links, overlays) are
 * named by what they are.
 */
export const SHELL_PLUGIN_ID = "kilo.shell";

export type IconComponent = ComponentType<{ className?: string }>;

// --- Extension points ---

export interface MainImplementation {
	/** The main-area view shown at "/". */
	readonly component: ComponentType;
	/** Replaces the page title in the window header. */
	readonly headerLeading?: ComponentType;
	/** Actions at the right of the window header. */
	readonly headerActions?: ComponentType;
}

/**
 * Put on the root of main-area content that brings its own surfaces (e.g.
 * pane islands): while it is in the page, the frame drops its card and inset
 * so that content sits straight on the window. `{ [SHELL_CANVAS_ATTRIBUTE]: "" }`.
 */
export const SHELL_CANVAS_ATTRIBUTE = "data-shell-canvas";

/** The main area of the window. Exactly one wins. */
export const Main = defineExtensionPoint({
	id: "kilo.shell/main",
	kind: "exclusive",
	description: "The main area of the window, shown when the app opens.",
	metadata: z.object({ title: z.string().optional() }),
	implementation: implementation<MainImplementation>("renderer"),
});

/** The left sidebar's body. Exactly one wins. */
export const LeftSidebar = defineExtensionPoint({
	id: "kilo.shell/left-sidebar",
	kind: "exclusive",
	description: "The left sidebar's body.",
	implementation: implementation<ComponentType>("renderer"),
});

/** The account entry at the foot of the left sidebar. Exactly one wins. */
export const LeftSidebarAccount = defineExtensionPoint({
	id: "kilo.shell/left-sidebar-account",
	kind: "exclusive",
	description: "The account entry at the foot of the left sidebar.",
	implementation: implementation<ComponentType>("renderer"),
});

/** Always-mounted UI for app-wide dialogs that commands open (e.g. Manage workspaces). */
export const Overlay = defineExtensionPoint({
	id: "kilo.shell/overlay",
	kind: "additive",
	description: "Always-mounted UI such as app-wide dialogs.",
	implementation: implementation<ComponentType>("renderer"),
});

/**
 * A notice above the account entry at the foot of the left sidebar, for
 * something to act on ("Restart to update").
 */
export const LeftSidebarNotice = defineExtensionPoint({
	id: "kilo.shell/left-sidebar-notice",
	kind: "additive",
	description: "A notice above the account entry in the left sidebar.",
	implementation: implementation<ComponentType>("renderer"),
});

export interface SettingsSectionImplementation {
	readonly component: ComponentType;
	readonly icon?: IconComponent;
}

/** The Settings categories kilo.shell ships; any plugin may add more. */
export const SETTINGS_CATEGORY = {
	general: "kilo.shell/general",
	ai: "kilo.shell/ai",
} as const;

/**
 * A heading in the Settings sidebar that sections sit under. Categories are
 * ordered by their `priority` (higher first); one with no visible sections
 * is not shown.
 */
export const SettingsCategory = defineExtensionPoint({
	id: "kilo.shell/settings-category",
	kind: "additive",
	description: "A heading in the Settings sidebar that sections sit under.",
	metadata: z.object({ title: z.string().min(1) }),
});

/**
 * A section of the Settings page. Its path is `/settings/<contribution id>`.
 * It sits under the category whose contribution key it names (General when
 * that category isn't installed), ordered within it by `priority`.
 */
export const SettingsSection = defineExtensionPoint({
	id: "kilo.shell/settings-section",
	kind: "additive",
	description: "A section of the Settings page.",
	metadata: z.object({
		title: z.string(),
		description: z.string().optional(),
		/** A `kilo.shell/settings-category` contribution key, e.g. `kilo.shell/ai`. */
		category: z.string().default(SETTINGS_CATEGORY.general),
	}),
	implementation: implementation<SettingsSectionImplementation>("renderer"),
});

/**
 * A block of Settings → About under the page header, ordered by `priority`
 * (higher first). kilo.shell ships Support (priority 200); put a block above
 * it with a higher priority or below it with a lower one.
 */
export const AboutSection = defineExtensionPoint({
	id: "kilo.shell/about-section",
	kind: "additive",
	description: "A block of Settings → About, such as the version and updates.",
	implementation: implementation<ComponentType>("renderer"),
});

/**
 * A panel in Settings → Account, one per account the app can sign in to
 * (Kilo, Anaconda), ordered by `priority`. A panel that renders nothing
 * leaves no frame behind.
 */
export const AccountPanel = defineExtensionPoint({
	id: "kilo.shell/account-panel",
	kind: "additive",
	description: "A panel in Settings → Account for an account the app can sign in to.",
	implementation: implementation<ComponentType>("renderer"),
});

/** A row in About → Support, such as where a config file lives. */
export const SupportRow = defineExtensionPoint({
	id: "kilo.shell/support-row",
	kind: "additive",
	description: "A row in About → Support with information to include when contacting support.",
	implementation: implementation<ComponentType>("renderer"),
});

/** How a status bar item's button looks right now; every field is optional. */
export interface StatusBarItemTrigger {
	/** Text after the icon. */
	readonly label?: ReactNode;
	readonly icon?: IconComponent;
	/** Hover text; the contribution's title by default. */
	readonly tooltip?: string;
	/** Accessible name; the contribution's title by default. */
	readonly ariaLabel?: string;
	/** Tints the item to draw attention. */
	readonly tone?: "default" | "warning" | "error";
	/** Leaves the item out; the status bar hides when nothing is left. */
	readonly hidden?: boolean;
}

export interface StatusBarItemPopoverProps {
	readonly close: () => void;
}

export type StatusBarItemImplementation =
	| {
			readonly kind: "view";
			/** Drawn as it is; render nothing to leave the item out. */
			readonly Component: ComponentType;
	  }
	| {
			readonly kind: "action";
			readonly useTrigger?: () => StatusBarItemTrigger;
			/** Runs on click; a contribution with `command` needs none. */
			readonly run?: () => void | Promise<void>;
	  }
	| {
			readonly kind: "popover";
			readonly useTrigger?: () => StatusBarItemTrigger;
			/** The popover's body; kilo.shell draws the popover above the status bar. */
			readonly Content: ComponentType<StatusBarItemPopoverProps>;
	  };

/**
 * An item in the status bar at the bottom of the window: a read-only view,
 * a button (`action`, running `run` or the contribution's `command`) or a
 * button opening a popover. `useTrigger` runs as a hook while the item shows.
 * Items sit at the bar's `start` (about the app or workspace: a server, sync)
 * or `end` (the default; about the open session), ordered by priority; hide
 * one with `when` or `hidden`. The bar shows only while an item renders. It
 * is for ambient status: something to act on goes in a left sidebar notice
 * or a toast.
 */
export const StatusBarItem = defineExtensionPoint({
	id: "kilo.shell/status-bar-item",
	kind: "additive",
	description: "An item in the window's status bar: a view, a button or a popover.",
	metadata: z.object({
		/** Accessible name and tooltip. */
		title: z.string().min(1),
		kind: z.enum(["view", "action", "popover"]).default("view"),
		align: z.enum(["start", "end"]).default("end"),
		/** For `action`: the command run on click (`kernel/command` key). */
		command: z.string().optional(),
	}),
	implementation: implementation<StatusBarItemImplementation>("renderer", { required: false }),
});

/** What an onboarding step's `useStep` returns while it is the current step. */
export interface OnboardingStepView {
	/** Card heading; splash steps render their own. */
	readonly title?: string;
	readonly subtitle?: string;
	readonly body: ReactNode;
	/** Showcase beside the card's body on wide windows. */
	readonly aside?: ReactNode;
	/** Centres the heading over a full-width body (no aside), e.g. a closing summary. */
	readonly centered?: boolean;
	/** The footer's main action; defaults to Continue. `null` hides it (splash steps act in their body). */
	readonly primary?: {
		readonly label: string;
		readonly disabled?: boolean;
		readonly onClick: () => void;
	} | null;
	/** Shows Skip, which moves on without the step's action. */
	readonly skippable?: boolean;
	/** The step is saving; the footer and exit are disabled. */
	readonly busy?: boolean;
}

export interface OnboardingControls {
	/** Moves to the next step, or finishes after the last. */
	next(): void;
}

export interface OnboardingStepImplementation {
	/** A hook, run only while this step is current. */
	useStep(controls: OnboardingControls): OnboardingStepView;
}

/**
 * A step of first-run onboarding, shown in priority order. A `required` step
 * is shown whenever its condition holds — even after onboarding finished —
 * and can't be dismissed, e.g. accepting the terms. `showWhen` offers a step
 * only when it applies at the moment onboarding opens.
 */
export const OnboardingStep = defineExtensionPoint({
	id: "kilo.shell/onboarding-step",
	kind: "additive",
	description: "A step of first-run onboarding.",
	metadata: z.object({
		/** Shown in the progress bar. */
		label: z.string(),
		/** `splash` fills the window and has no progress bar or footer. */
		layout: z.enum(["card", "splash"]).default("card"),
		required: whenSchema.optional(),
		/**
		 * Offer the step only if this holds when onboarding opens. Checked once,
		 * so finishing the step's own task (which may flip it) never removes it
		 * mid-flow.
		 */
		showWhen: whenSchema.optional(),
	}),
	implementation: implementation<OnboardingStepImplementation>("renderer"),
});

/**
 * Maps an app URL host to a route: `<scheme>://<host>?a=1` navigates to
 * `path`, carrying the listed query parameters as search parameters, and the
 * URL's first path segment (`<scheme>://<host>/<id>`) as `pathParam`.
 */
export const DeepLink = defineExtensionPoint({
	id: "kilo.shell/deep-link",
	kind: "additive",
	description: "Routes an app URL host to a page.",
	metadata: z.object({
		host: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
		path: z.string().startsWith("/"),
		query: z.array(z.string()).default([]),
		pathParam: z.string().min(1).optional(),
	}),
});

/** The native app menu's standard menus; `app` is macOS's application menu (File elsewhere). */
export const APP_MENUS = ["app", "file", "edit", "view", "window", "help"] as const;
export type AppMenuName = (typeof APP_MENUS)[number];

/**
 * A command in the native app menu. Items of one `group` sit together,
 * between separators, in contribution order (priority, then plugin order).
 * The label is the command's title unless one is given here, and the
 * shortcut is the command's current one. An item is greyed out while its
 * command can't run in the focused window; hide it with `when`.
 */
export const MenuItem = defineExtensionPoint({
	id: "kilo.shell/menu-item",
	kind: "additive",
	description: "A command in the native app menu.",
	metadata: z.object({
		/** The `kernel/command` key to run. */
		command: z.string().min(1),
		menu: z.enum(APP_MENUS).default("file"),
		/** Replaces the command's title in the menu, e.g. "Settings…". */
		label: z.string().min(1).optional(),
		group: z.string().min(1).default("default"),
	}),
});

// --- Domain objects ---

const textSizes = z.object({ ui: z.number(), chat: z.number() });

export const appearanceState = z.object({
	source: z.enum(THEME_SOURCES),
	themeId: z.string(),
	accentId: z.string(),
	sidebarVibrancy: z.boolean(),
	textSizes,
	/** False until preferences have been saved once (used to adopt older local settings). */
	persisted: z.boolean(),
});
export type AppearanceState = z.output<typeof appearanceState>;

export const appearancePatch = appearanceState.omit({ persisted: true }).partial();
export type AppearancePatch = z.output<typeof appearancePatch>;

export const DEFAULT_APPEARANCE: AppearanceState = {
	source: "dark" satisfies ThemeSource,
	themeId: DEFAULT_APP_THEME_PREFERENCES.themeId,
	accentId: DEFAULT_APP_THEME_PREFERENCES.accentId,
	sidebarVibrancy: true,
	textSizes: DEFAULT_TEXT_SIZES,
	persisted: false,
};

/** The user's appearance preferences, saved in main and shared by every window. */
export const Appearance = defineDomain({
	id: "kilo.shell/appearance",
	home: "main",
	state: appearanceState,
	methods: {
		update: method(appearancePatch, appearanceState),
	},
});

const terminalPalette = z.record(z.string(), z.string()) as unknown as z.ZodType<TerminalPalette>;

/** The effective theme in this window, for surfaces that paint their own content. */
export const Theme = defineDomain({
	id: "kilo.shell/theme",
	home: "renderer",
	state: z.object({
		mode: z.enum(["light", "dark"]),
		themeId: z.string(),
		accentId: z.string(),
		terminal: terminalPalette.nullable(),
		shiki: z.string(),
	}),
});

const searchParams = z.record(z.string(), z.string());

/** Where the main window is, and how to move it. */
export const Navigation = defineDomain({
	id: "kilo.shell/navigation",
	home: "renderer",
	state: z.object({ path: z.string(), search: searchParams }),
	methods: {
		navigate: method(
			z.object({ path: z.string(), search: searchParams.optional() }),
			z.undefined(),
		),
		openSettings: method(z.object({ section: z.string().optional() }), z.undefined()),
		goHome: method(z.undefined(), z.undefined()),
	},
});

export const SHELL_EXTENSION_POINTS = [
	Main,
	LeftSidebar,
	LeftSidebarAccount,
	LeftSidebarNotice,
	Overlay,
	SettingsCategory,
	SettingsSection,
	AboutSection,
	SupportRow,
	AccountPanel,
	StatusBarItem,
	DeepLink,
	OnboardingStep,
	MenuItem,
];
/**
 * Bump when onboarding changes enough that people who finished or skipped an
 * older version should see it again.
 */
export const ONBOARDING_VERSION = 2;

export const onboardingState = z.object({
	outcome: z.enum(["completed", "skipped"]).nullable(),
	/** The onboarding version the outcome was recorded against. */
	version: z.number().nullable(),
});
export type OnboardingState = z.output<typeof onboardingState>;

/** Whether first-run onboarding was finished or skipped. */
export const Onboarding = defineDomain({
	id: "kilo.shell/onboarding",
	home: "main",
	state: onboardingState,
	methods: {
		complete: method(z.undefined(), z.undefined()),
		skip: method(z.undefined(), z.undefined()),
		/** Records that onboarding was shown this session. */
		markShown: method(z.undefined(), z.undefined()),
	},
	events: {
		shown: z.object({}),
		completed: z.object({}),
		skipped: z.object({}),
	},
});

export const SHELL_DOMAINS = [Appearance, Theme, Navigation, Onboarding];

import type { ComponentType, ReactNode } from "react";
import { z } from "zod";

import {
	defineExtensionPoint,
	implementation,
	whenSchema,
	type KeyboardPlatform,
} from "@kilo-desktop/kernel";

/**
 * The frame's regions are named by where they are (`main`, `left-sidebar`,
 * `sidebar-notice`, `top-bar-title`, `top-bar-action`, `status-bar-item`,
 * `right-sidebar-panel`); points that
 * aren't places (settings, onboarding, dialogs, deep links, menu items) are
 * named by what they are.
 */

export type IconComponent = ComponentType<{ className?: string }>;

// --- The window ---

export interface MainImplementation {
	/** The main-area view shown at "/". */
	readonly component: ComponentType;
}

/**
 * Put on the root of main-area content that brings its own surfaces (e.g.
 * pane islands): while it is in the page, the frame drops its card and inset
 * so that content sits straight on the window. `{ [SHELL_CANVAS_ATTRIBUTE]: "" }`.
 * A marker under a `hidden` element doesn't count, so content kept mounted
 * out of sight (e.g. under a hidden `Activity`) must sit in one.
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

/**
 * Something to act on, above the account entry at the foot of the left
 * sidebar ("Restart to update"). Ambient status belongs in the status bar.
 */
export const SidebarNotice = defineExtensionPoint({
	id: "kilo.shell/sidebar-notice",
	kind: "additive",
	description: "Something to act on, at the foot of the left sidebar.",
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

/**
 * Props of a status bar item's `Trigger`: it reads the item's state with hooks
 * and returns `children(trigger)`, so kilo.shell draws the button from it.
 */
export interface StatusBarItemTriggerProps {
	readonly children: (trigger: StatusBarItemTrigger) => ReactNode;
}

export type StatusBarItemImplementation =
	| {
			readonly kind: "view";
			/** Drawn as it is; render nothing to leave the item out. */
			readonly Component: ComponentType;
	  }
	| {
			readonly kind: "action";
			/** How the button looks; the contribution's title by default. */
			readonly Trigger?: ComponentType<StatusBarItemTriggerProps>;
			/** Runs on click; a contribution with `command` needs none. */
			readonly run?: () => void | Promise<void>;
	  }
	| {
			readonly kind: "popover";
			/** How the button looks; the contribution's title by default. */
			readonly Trigger?: ComponentType<StatusBarItemTriggerProps>;
			/** The popover's body; kilo.shell draws the popover above the status bar. */
			readonly Content: ComponentType<StatusBarItemPopoverProps>;
	  };

/**
 * An item in the status bar at the bottom of the window: a read-only view, a
 * button (`action`, running `run` or the contribution's `command`) or a
 * button opening a popover. kilo.shell renders the item's `Trigger` while the
 * item shows and draws the button from what it hands to `children`.
 * Items sit at the bar's `start` (about the app or workspace) or `end` (the
 * default; about what is open), ordered by priority. The bar shows only while
 * an item renders. It is for ambient status: something to act on goes in a
 * sidebar notice or a notification.
 */
export const StatusBarItem = defineExtensionPoint({
	id: "kilo.shell/status-bar-item",
	kind: "additive",
	description: "Ambient status in the window's status bar: a view, an action or a popover.",
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

/*
 * The top bar runs above the main area at "/": a title at the left, actions
 * at the right. Gate contributions with `when` on what they are about (an
 * open session, a view) so they are active only while they have something to
 * show. With no title and no action the bar collapses to the pane gutter
 * while the docked sidebar carries the window controls, so a contribution
 * that renders nothing still holds it open.
 */

/**
 * What names the main area in the top bar, in place of the `main`
 * contribution's own `title`. Exactly one wins.
 */
export const TopBarTitle = defineExtensionPoint({
	id: "kilo.shell/top-bar-title",
	kind: "exclusive",
	description: "What names the main area in the window's top bar, in place of its title.",
	implementation: implementation<ComponentType>("renderer"),
});

/** Actions at the right of the top bar, ordered by priority. */
export const TopBarAction = defineExtensionPoint({
	id: "kilo.shell/top-bar-action",
	kind: "additive",
	description: "Actions at the right of the window's top bar.",
	implementation: implementation<ComponentType>("renderer"),
});

export interface RightSidebarPanelImplementation {
	readonly component: ComponentType;
	readonly icon?: IconComponent;
}

/**
 * A panel in the right sidebar: an icon in the rail along the window's right
 * edge that opens the panel beside the main area, one at a time, resizable
 * from a splitter. Ordered by `priority` (higher first); the rail shows while
 * at least one panel is available.
 */
export const RightSidebarPanel = defineExtensionPoint({
	id: "kilo.shell/right-sidebar-panel",
	kind: "additive",
	description: "A panel in the right sidebar, opened from its icon in the rail.",
	metadata: z.object({
		title: z.string().min(1),
		/** Starting width in pixels, until the person resizes it (default 420). */
		width: z.number().int().min(280).optional(),
	}),
	implementation: implementation<RightSidebarPanelImplementation>("renderer"),
});

export interface DialogProps {
	/** Closes the dialog. */
	readonly close: () => void;
	/** What the opening command was given (`openDialog`'s `input`). */
	readonly input: unknown;
}

/**
 * An app-wide dialog. kilo.shell mounts it only while it is open: open it
 * with `kilo.shell/navigation`'s `openDialog({ dialog: "<plugin>/<id>" })`,
 * typically from a command.
 */
export const Dialog = defineExtensionPoint({
	id: "kilo.shell/dialog",
	kind: "additive",
	description: "An app-wide dialog opened by command.",
	metadata: z.object({ title: z.string().min(1) }),
	implementation: implementation<ComponentType<DialogProps>>("renderer"),
});

export interface TakeoverProps {
	/** Closes the take-over. */
	readonly close: () => void;
	/** What the opener passed (`openTakeover`'s `input`). */
	readonly input: unknown;
}

/**
 * A full-window take-over (a reading mode, a presentation): shown over the
 * whole frame — sidebar, top bar, main area, right sidebar and status bar —
 * which stays mounted underneath, inert. One at a time, mounted only while
 * open: open it with `kilo.shell/navigation`'s
 * `openTakeover({ takeover: "<plugin>/<id>" })`. Unlike a dialog it is not
 * modal, so the window's shortcuts keep working; it handles its own Escape.
 */
export const Takeover = defineExtensionPoint({
	id: "kilo.shell/takeover",
	kind: "additive",
	description: "A full-window take-over of the frame, opened by key.",
	metadata: z.object({ title: z.string().min(1) }),
	implementation: implementation<ComponentType<TakeoverProps>>("renderer"),
});

// --- Settings ---

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
 * A heading in the Settings sidebar that sections sit under, ordered by
 * `priority` (higher first). One with no visible sections is not shown.
 */
export const SettingsCategory = defineExtensionPoint({
	id: "kilo.shell/settings-category",
	kind: "additive",
	description: "A heading in the Settings sidebar.",
	metadata: z.object({ title: z.string().min(1) }),
});

/**
 * A Settings page, at `/settings/<contribution key>`. It sits under the
 * category whose contribution key it names (General when that category isn't
 * installed), ordered by `priority`. Settings stay per plugin: each plugin
 * keeps its own domain object and draws its own page.
 */
export const SettingsSection = defineExtensionPoint({
	id: "kilo.shell/settings-section",
	kind: "additive",
	description: "A Settings page.",
	metadata: z.object({
		title: z.string(),
		description: z.string().optional(),
		/** A `kilo.shell/settings-category` contribution key, e.g. `kilo.shell/ai`. */
		category: z.string().default(SETTINGS_CATEGORY.general),
	}),
	implementation: implementation<SettingsSectionImplementation>("renderer"),
});

/**
 * An AI provider's panel in Settings → AI Providers, contributed by the
 * plugin that owns its account (Kilo Gateway, the local model server). The
 * page shows these above the provider list and leaves those AI providers out
 * of the list.
 */
export const AiProviderPanel = defineExtensionPoint({
	id: "kilo.shell/ai-provider-panel",
	kind: "additive",
	description: "An AI provider's panel in Settings → AI Providers.",
	metadata: z.object({ aiProviderId: z.string().min(1) }),
	implementation: implementation<ComponentType>("renderer"),
});

/** One row of the ⌘/ shortcuts list that a shortcuts panel draws for some of its commands. */
export interface ShortcutsListRow {
	readonly title: string;
	/** Shortcut labels as shown, e.g. `["⇧⌘E"]`. */
	readonly labels: readonly string[];
	/** Command keys the row stands for; it takes the place of the first one. */
	readonly commands: readonly string[];
	/** Extra words the list's search matches, e.g. the titles of `commands`. */
	readonly searchText?: string;
}

export interface ShortcutsPanelImplementation {
	/** Drawn above the shortcut list in Settings → Shortcuts. */
	readonly component: ComponentType;
	/**
	 * Rows for the ⌘/ list. A claimed command no row covers gets its own row,
	 * so a panel can return nothing (or leave this out) for a state it can't
	 * sum up.
	 */
	readonly listRows?: (input: {
		readonly platform: KeyboardPlatform;
		readonly overrides: Readonly<Record<string, string | null>>;
	}) => readonly ShortcutsListRow[];
}

/**
 * A panel in Settings → Shortcuts for shortcuts a plugin edits in its own
 * way (several commands changed together), ordered by `priority`.
 * Settings leaves the `commands` it claims (qualified command keys) out of
 * its list; the ⌘/ list shows the panel's `listRows` for them.
 */
export const ShortcutsPanel = defineExtensionPoint({
	id: "kilo.shell/shortcuts-panel",
	kind: "additive",
	description: "A panel of shortcuts in Settings → Shortcuts.",
	metadata: z.object({ title: z.string(), commands: z.array(z.string()) }),
	implementation: implementation<ShortcutsPanelImplementation>("renderer"),
});

/**
 * A panel in Settings → Account, one per account the app can sign in to
 * (Kilo, Anaconda), ordered by `priority`. A panel that renders nothing
 * leaves no frame behind.
 */
export const AccountPanel = defineExtensionPoint({
	id: "kilo.shell/account-panel",
	kind: "additive",
	description: "An account in Settings → Account.",
	implementation: implementation<ComponentType>("renderer"),
});

/**
 * A block of Settings → About, ordered by `priority` (higher first). kilo.shell
 * ships `version` (300), `support` (200) and `legal` (100).
 */
export const AboutSection = defineExtensionPoint({
	id: "kilo.shell/about-section",
	kind: "additive",
	description: "A block of Settings → About.",
	implementation: implementation<ComponentType>("renderer"),
});

/** A row in About → Support with something to include when contacting support. */
export const SupportRow = defineExtensionPoint({
	id: "kilo.shell/support-row",
	kind: "additive",
	description: "A row in About → Support.",
	implementation: implementation<ComponentType>("renderer"),
});

// --- Onboarding ---

/** What an onboarding step's `Step` hands to `children` while it is the current step. */
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

/**
 * Props of an onboarding step's `Step`: it reads the step's state with hooks
 * and returns `children(view)`, which kilo.shell draws in its frame.
 */
export interface OnboardingStepProps extends OnboardingControls {
	readonly children: (view: OnboardingStepView) => ReactNode;
}

export interface OnboardingStepImplementation {
	/** Rendered only while this step is current, in the step's plugin context. */
	readonly Step: ComponentType<OnboardingStepProps>;
}

/**
 * A first-run onboarding step, shown in priority order. A `required` step is
 * shown whenever its condition holds — even after onboarding finished — and
 * can't be dismissed (accepting the terms). `showWhen` offers a step only if
 * it holds when onboarding opens.
 */
export const OnboardingStep = defineExtensionPoint({
	id: "kilo.shell/onboarding-step",
	kind: "additive",
	description: "A first-run onboarding step.",
	metadata: z.object({
		/** Shown in the progress bar. */
		label: z.string(),
		/** `splash` fills the window and has no progress bar or footer. */
		layout: z.enum(["card", "splash"]).default("card"),
		required: whenSchema.optional(),
		/** Checked once when onboarding opens, so finishing the step never removes it mid-flow. */
		showWhen: whenSchema.optional(),
	}),
	implementation: implementation<OnboardingStepImplementation>("renderer"),
});

// --- The app around the window ---

/** The native app menu's standard menus; `app` is macOS's application menu (File elsewhere). */
export const APP_MENUS = ["app", "file", "edit", "view", "window", "help"] as const;
export type AppMenuName = (typeof APP_MENUS)[number];

/**
 * A command in the native app menu. Items of one `group` sit together,
 * between separators, in contribution order. The label is the command's title
 * unless one is given; the shortcut is the command's current one. An item is
 * greyed out while its command can't run in the focused window.
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

/**
 * Routes an app URL host to a page: `<scheme>://<host>?a=1` navigates to
 * `path`, carrying the listed query parameters as search parameters, and the
 * URL's first path segment (`<scheme>://<host>/<id>`) as `pathParam`.
 */
export const DeepLink = defineExtensionPoint({
	id: "kilo.shell/deep-link",
	kind: "additive",
	description: "An app URL host routed to a page.",
	metadata: z.object({
		host: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
		path: z.string().startsWith("/"),
		query: z.array(z.string()).default([]),
		pathParam: z.string().min(1).optional(),
	}),
});

export const SHELL_EXTENSION_POINTS = [
	Main,
	LeftSidebar,
	SidebarNotice,
	StatusBarItem,
	TopBarTitle,
	TopBarAction,
	RightSidebarPanel,
	Dialog,
	Takeover,
	SettingsCategory,
	SettingsSection,
	AiProviderPanel,
	ShortcutsPanel,
	AccountPanel,
	AboutSection,
	SupportRow,
	OnboardingStep,
	MenuItem,
	DeepLink,
];

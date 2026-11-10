import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";
import { DEFAULT_APP_THEME_PREFERENCES } from "@kilo-desktop/ui/themes/app-themes";
import type { TerminalPalette } from "@kilo-desktop/ui/themes/appearance-types";
import {
	DEFAULT_TEXT_SIZES,
	THEME_SOURCES,
	type ThemeSource,
} from "@kilo-desktop/ui/themes/theme-tokens";

const nothing = z.undefined();

// --- Appearance and theme ---

const textSizes = z.object({ ui: z.number(), chat: z.number() });

export const appearanceStateSchema = z.object({
	source: z.enum(THEME_SOURCES),
	themeId: z.string(),
	accentId: z.string(),
	sidebarVibrancy: z.boolean(),
	textSizes,
});
export type AppearanceState = z.output<typeof appearanceStateSchema>;

export const appearancePatchSchema = appearanceStateSchema.partial();
export type AppearancePatch = z.output<typeof appearancePatchSchema>;

export const DEFAULT_APPEARANCE: AppearanceState = {
	source: "dark" satisfies ThemeSource,
	themeId: DEFAULT_APP_THEME_PREFERENCES.themeId,
	accentId: DEFAULT_APP_THEME_PREFERENCES.accentId,
	sidebarVibrancy: true,
	textSizes: DEFAULT_TEXT_SIZES,
};

/** Saved appearance preferences, shared by every window. */
export const Appearance = defineDomainObject({
	id: "kilo.shell/appearance",
	home: "main",
	description: "Saved appearance preferences.",
	state: appearanceStateSchema,
	methods: {
		update: method(appearancePatchSchema, appearanceStateSchema),
	},
});

const terminalPaletteSchema = z.record(
	z.string(),
	z.string(),
) as unknown as z.ZodType<TerminalPalette>;

/** The effective theme in this window, for surfaces that paint their own content. */
export const Theme = defineDomainObject({
	id: "kilo.shell/theme",
	home: "renderer",
	description: "The effective theme in this window.",
	state: z.object({
		mode: z.enum(["light", "dark"]),
		themeId: z.string(),
		accentId: z.string(),
		terminal: terminalPaletteSchema.nullable(),
		shiki: z.string(),
	}),
});

// --- Navigation ---

const searchSchema = z.record(z.string(), z.string());

export const windowLocationSchema = z.object({ path: z.string(), search: searchSchema });
export type WindowLocation = z.output<typeof windowLocationSchema>;

/** Which window a request is for: the caller's own by default, else the main window. */
const windowTarget = { windowId: z.string().min(1).optional() };

/**
 * Where each window is, and requests to move one: navigate, open a settings
 * section, go home, open a dialog. Callable from main or a window, so a main
 * process tool can "open my settings" without its own event. Windows apply
 * the request (`navigate-requested`, `dialog-requested`) and report where
 * they are.
 */
export const Navigation = defineDomainObject({
	id: "kilo.shell/navigation",
	home: "main",
	description: "Where each window is, and requests to move one.",
	state: z.object({ windows: z.record(z.string(), windowLocationSchema) }),
	lookup: (state, windowId) => state.windows[windowId],
	methods: {
		navigate: method(
			z.object({ path: z.string(), search: searchSchema.optional(), ...windowTarget }),
			nothing,
		),
		/** `section` is a `kilo.shell/settings-section` contribution key; Settings' first section without one. */
		openSettings: method(z.object({ section: z.string().optional(), ...windowTarget }), nothing),
		goHome: method(z.object(windowTarget), nothing),
		/** Opens a `kilo.shell/dialog` contribution (its key), with `input` for it. */
		openDialog: method(
			z.object({ dialog: z.string().min(1), input: z.unknown().optional(), ...windowTarget }),
			nothing,
		),
		/** A window says where it is now; kilo.shell's own windows only. */
		reportLocation: method(windowLocationSchema, nothing),
	},
	events: {
		"navigate-requested": z.object({
			windowId: z.string(),
			path: z.string(),
			search: searchSchema,
		}),
		"dialog-requested": z.object({
			windowId: z.string(),
			dialog: z.string(),
			input: z.unknown().optional(),
		}),
	},
});

// --- Notifications ---

export const NOTIFICATION_LEVELS = ["info", "success", "warning", "error"] as const;

const notificationActionSchema = z.object({
	label: z.string().min(1),
	/** A `kernel/command` key run when the action is chosen. */
	command: z.string().min(1),
	input: z.unknown().optional(),
});

const notificationContentSchema = z.object({
	level: z.enum(NOTIFICATION_LEVELS).default("info"),
	title: z.string().min(1),
	description: z.string().optional(),
	action: notificationActionSchema.optional(),
});
export type NotificationContent = z.input<typeof notificationContentSchema>;

export const noticeSchema = notificationContentSchema.extend({
	id: z.string(),
	/** The plugin that posted it. */
	pluginId: z.string(),
	createdAt: z.number(),
});
export type Notice = z.output<typeof noticeSchema>;

/**
 * Toasts and in-app notices, callable from main or a window. A toast is
 * transient and shows in one window (the caller's, else the main window); a
 * notice stays, in every window, until it is dismissed.
 */
export const Notifications = defineDomainObject({
	id: "kilo.shell/notifications",
	home: "main",
	description: "Toasts and in-app notices.",
	state: z.object({ notices: z.record(z.string(), noticeSchema) }),
	lookup: (state, id) => state.notices[id],
	methods: {
		toast: method(notificationContentSchema.extend(windowTarget), nothing),
		/** Posts a notice, or replaces the caller's notice with the same `id`; returns its id. */
		post: method(
			notificationContentSchema.extend({ id: z.string().min(1).optional() }),
			z.string(),
		),
		dismiss: method(z.object({ id: z.string().min(1) }), nothing),
	},
	events: {
		toast: notificationContentSchema.extend({ windowId: z.string(), pluginId: z.string() }),
	},
});

// --- Onboarding ---

/**
 * Bump when onboarding changes enough that people who finished or skipped an
 * older version should see it again.
 */
export const ONBOARDING_VERSION = 2;

export const onboardingStateSchema = z.object({
	outcome: z.enum(["completed", "skipped"]).nullable(),
	/** The onboarding version the outcome was recorded against. */
	version: z.number().nullable(),
});
export type OnboardingState = z.output<typeof onboardingStateSchema>;

/** Whether first-run onboarding was finished or skipped. */
export const Onboarding = defineDomainObject({
	id: "kilo.shell/onboarding",
	home: "main",
	description: "Whether onboarding was finished or skipped.",
	state: onboardingStateSchema,
	methods: {
		complete: method(nothing, nothing),
		skip: method(nothing, nothing),
		/** Records that onboarding was shown this session. */
		markShown: method(nothing, nothing),
	},
	events: {
		shown: z.object({}),
		completed: z.object({}),
		skipped: z.object({}),
	},
});

// --- Legal ---

export const readableLegalDocumentSchema = z.enum(["third-party-notices"]);
export const legalDocumentSchema = z.enum([
	...readableLegalDocumentSchema.options,
	"chromium-notices",
]);
export type LegalDocument = z.output<typeof legalDocumentSchema>;

/**
 * The legal documents packaging writes beside the app: the third-party
 * notices and Chromium's credits (HTML, so only located). Every method
 * answers `null` where a document isn't shipped (development).
 */
export const Legal = defineDomainObject({
	id: "kilo.shell/legal",
	home: "main",
	description: "The legal documents shipped with the app, shown in About → Legal.",
	state: z.object({}),
	methods: {
		/** The document's path, for revealing it in the file manager. */
		locate: method(z.object({ document: legalDocumentSchema }), z.string().nullable()),
		read: method(z.object({ document: readableLegalDocumentSchema }), z.string().nullable()),
	},
});

export const SHELL_DOMAIN_OBJECTS = [
	Appearance,
	Theme,
	Navigation,
	Notifications,
	Onboarding,
	Legal,
];

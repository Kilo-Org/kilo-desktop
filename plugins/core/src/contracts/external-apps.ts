import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

const nothing = z.undefined();

/**
 * The flag behind External AI apps: starting the listener, enabling and
 * pairing. Its id is the flag service's key, kept from before v2.
 */
export const EXTERNAL_AI_APPS_FLAG = "external-api-apps-settings";

export const EXTERNAL_APP_NAME_MAX_LENGTH = 64;

/** A paired external AI app. Its token is shown once and stored only as a hash. */
export const externalAppSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	createdAt: z.string().min(1),
	lastUsedAt: z.string().min(1).optional(),
});
export type ExternalApp = z.output<typeof externalAppSchema>;

export const externalAppsListenerSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("stopped") }),
	z.object({ status: z.literal("running"), url: z.url() }),
	z.object({ status: z.literal("error"), message: z.string().min(1) }),
]);
export type ExternalAppsListener = z.output<typeof externalAppsListenerSchema>;

export const externalAppPortSchema = z.number().int().min(1024).max(65535);

export const externalAppsStateSchema = z.object({
	/** Whether paired apps may connect. Off by default. */
	enabled: z.boolean(),
	/** The loopback port the listener uses while enabled. */
	port: z.number().int(),
	/** The release track's default port, used when the user has not chosen one. */
	defaultPort: z.number().int(),
	listener: externalAppsListenerSchema,
	apps: z.array(externalAppSchema),
});
export type ExternalAppsState = z.output<typeof externalAppsStateSchema>;

/**
 * Apps such as Cursor or Claude Code using the app's `external` tools over
 * MCP on a loopback port, plus the listener's settings and status. Pairing
 * hands out a token, so only kilo.core and kilo.shell (its settings page) may
 * change anything.
 */
export const ExternalApps = defineDomainObject({
	id: "kilo.core/external-apps",
	home: "main",
	description: "Paired external AI apps, plus the listener's settings and status.",
	state: externalAppsStateSchema,
	lookup: (state, id) => state.apps.find((app) => app.id === id),
	methods: {
		setEnabled: method(z.object({ enabled: z.boolean() }), nothing),
		/** `null` returns to the default port. */
		setPort: method(z.object({ port: externalAppPortSchema.nullable() }), nothing),
		pair: method(
			z.object({ name: z.string().trim().min(1).max(EXTERNAL_APP_NAME_MAX_LENGTH) }),
			/** The token is returned only here; the app keeps its hash. */
			z.object({ app: externalAppSchema, token: z.string().min(1) }),
		),
		/** Disconnects the app at once; its token stops working. */
		revoke: method(z.object({ id: z.string().min(1) }), nothing),
	},
});

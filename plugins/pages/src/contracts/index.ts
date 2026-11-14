import { z } from "zod";

import { defineDomainObject, method, type PluginDefinitions } from "@kilo-desktop/kernel";

/**
 * kilo.pages' public surface: the local Pages server other plugins (and this
 * plugin's own windows) can read and start.
 */
export const PAGES_PLUGIN_ID = "kilo.pages";
export const PAGES_PANE_KIND = "kilo.pages/pages";
export const PAGES_SERVICE_KEY = "kilo.pages/server";
export const PAGES_OPEN_COMMAND = "kilo.pages/open";

/** The Kilo server environment variables the `pages-local` MCP entry reads. */
export const PAGES_SERVER_ENV = {
	mcpUrl: "PAGES_MCP_URL",
	mcpToken: "PAGES_MCP_TOKEN",
} as const;

export const PAGES_SERVER_STATUSES = [
	"stopped",
	"starting",
	"running",
	"error",
	"unavailable",
] as const;
export type PagesServerStatus = (typeof PAGES_SERVER_STATUSES)[number];

export const pagesServerStateSchema = z.object({
	status: z.enum(PAGES_SERVER_STATUSES),
	/** Where the browser reaches Pages; null until it has been started once. */
	origin: z.string().nullable(),
	/** Why it is `error` or `unavailable`. */
	message: z.string().nullable(),
});
export type PagesServerState = z.output<typeof pagesServerStateSchema>;

/** The Pages server on this device, run by kilo.pages' `server` service. */
export const PagesServer = defineDomainObject({
	id: "kilo.pages/server",
	home: "main",
	state: pagesServerStateSchema,
	methods: {
		/** Starts the server if it isn't running; resolves once it answers. */
		ensure: method(z.undefined(), z.object({ origin: z.string() })),
		/**
		 * Starts the server and readies the browser session a Pages pane's
		 * guest must use; `url` signs the guest in and lands on the Pages list.
		 */
		prepareView: method(z.undefined(), z.object({ partition: z.string(), url: z.string() })),
	},
});

export const PAGES_DEFINITIONS: PluginDefinitions = { domainObjects: [PagesServer] };

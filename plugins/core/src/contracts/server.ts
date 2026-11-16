import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

const nothing = z.undefined();

/** The `kernel/services` key of the Kilo server daemon. */
export const SERVER_SERVICE_KEY = "kilo.core/server";

/**
 * The plugins that may hold a live connection to the Kilo server: kilo.core
 * itself and the UI plugins that draw Kilo directly (the chat transcript,
 * provider settings, the marketplace). The password drives every chat.
 */
export const SERVER_CLIENT_PLUGINS: readonly string[] = [
	"kilo.core",
	"kilo.shell",
	"kilo.chat",
	"kilo.marketplace",
	// Calls the Pages tools on Kilo's MCP connections to read and write workbooks.
	"kilo.workbooks",
];

export const serverStatusSchema = z.object({
	status: z.enum(["stopped", "starting", "ready", "error"]),
	/** The CLI version, once ready. */
	version: z.string().optional(),
	/** Why the server is not running, when it failed. */
	message: z.string().optional(),
	/** The CLI's own output from a failed start. */
	detail: z.string().optional(),
});
export type ServerStatus = z.output<typeof serverStatusSchema>;

/** How to reach the running server; the password changes when the server is replaced. */
export const serverConnectionSchema = z.object({
	baseUrl: z.string(),
	username: z.string(),
	password: z.string(),
	version: z.string(),
	/** The server's working directory for requests not tied to a workspace. */
	globalDirectory: z.string(),
});
export type ServerConnection = z.output<typeof serverConnectionSchema>;

export const userConfigFileSchema = z.object({
	path: z.string(),
	/** False until the user creates the file. */
	exists: z.boolean(),
});
export type UserConfigFile = z.output<typeof userConfigFileSchema>;

/**
 * The Kilo CLI the app ships and the local server it runs: status for
 * everyone, and a connection for the app's own Kilo clients
 * ({@link SERVER_CLIENT_PLUGINS}).
 */
export const KiloServer = defineDomainObject({
	id: "kilo.core/server",
	home: "main",
	description: "The Kilo CLI server: status, connection and restart.",
	state: serverStatusSchema,
	methods: {
		/** Waits until the server is ready, starting it if needed, and says how to reach it. */
		connect: method(nothing, serverConnectionSchema),
		restart: method(nothing, nothing),
		/**
		 * Releases the server's instance for a directory (its MCP servers, file
		 * watcher and processes), so the directory can be removed. Waits up to
		 * 5 s for the server to confirm; does nothing while it is not running.
		 */
		disposeInstance: method(z.object({ directory: z.string().min(1) }), nothing),
		/** The user's own global Kilo config file, which the app never writes. */
		userConfigFile: method(nothing, userConfigFileSchema),
	},
});

import type { ServerConnection, UserConfigFile } from "../contracts";

export type KiloServerConnection = ServerConnection;

/** The server manager's own status; `ready` carries the address it listens on. */
export type KiloServerStatus =
	| { readonly status: "stopped" }
	| { readonly status: "starting" }
	| { readonly status: "ready"; readonly baseUrl: string; readonly version: string }
	| {
			readonly status: "error";
			readonly message: string;
			/** Diagnostic detail from stderr when the server exits early. */
			readonly detail?: string;
	  };

export interface KiloConfigurationState {
	readonly mcpEntries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	readonly plugins: Readonly<Record<string, string>>;
}

export type KiloGlobalConfigFile = UserConfigFile;

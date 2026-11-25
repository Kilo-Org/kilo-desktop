import type { McpServerEntry, ServerConnection, UserConfigFile } from "../../contracts";

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

type KiloConfigEntries = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** One source's complete Kilo configuration, each part keyed by its name in Kilo. */
export interface KiloConfigurationState {
	/** Kilo v2 config `mcp.servers` entries. */
	readonly mcpEntries: Readonly<Record<string, McpServerEntry>>;
	/** Kilo v2 config `agents` entries (`Config.Agent`). */
	readonly agents: KiloConfigEntries;
	/** Kilo v2 config `commands` entries (`Config.Command`). */
	readonly commands: KiloConfigEntries;
	/** Desktop-managed Kilo plugin modules, by absolute path. */
	readonly plugins: Readonly<Record<string, string>>;
	/** Skill folders (holding `SKILL.md`), by absolute path. */
	readonly skills: Readonly<Record<string, string>>;
}

export type KiloGlobalConfigFile = UserConfigFile;

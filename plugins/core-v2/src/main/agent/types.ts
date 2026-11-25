import type { ServerConnection, UserConfigFile } from "../../contracts";
import type { KiloAgent, KiloCommand, KiloMcpServer } from "./kilo-config-types";

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

/** One source's complete Kilo configuration, each part keyed by its name in Kilo. */
export interface KiloConfigurationState {
	/** Kilo config `mcp.servers` entries. */
	readonly mcpServers: Readonly<Record<string, KiloMcpServer>>;
	/** Kilo config `agents` entries. */
	readonly agents: Readonly<Record<string, KiloAgent>>;
	/** Kilo config `commands` entries. */
	readonly commands: Readonly<Record<string, KiloCommand>>;
	/** Desktop-managed Kilo plugin modules, by absolute path. */
	readonly plugins: Readonly<Record<string, string>>;
	/** Skill folders (holding `SKILL.md`), by absolute path. */
	readonly skills: Readonly<Record<string, string>>;
}

export type KiloGlobalConfigFile = UserConfigFile;

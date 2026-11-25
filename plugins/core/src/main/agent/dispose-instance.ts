import type { ServerConnection } from "../../contracts";
import { createServerClient, type ServerClientOptions } from "./server-client";

export type InstanceDisposer = (connection: ServerConnection, directory: string) => Promise<void>;

/**
 * Releases the Kilo server's location for one directory, which stops the MCP
 * servers, file watcher and other processes it runs there. Windows refuses to
 * rename or delete a directory that is some process's working directory, so a
 * worktree must be released this way before it can be removed.
 *
 * Kilo v2's `debug.location.evict` (`DELETE /api/debug/location`) disposes the
 * location's services before it answers, so there is no completion event to
 * wait for. The v2 VS Code client releases worktrees the same way.
 */
export function createInstanceDisposer(options: ServerClientOptions = {}): InstanceDisposer {
	return async (connection, directory) => {
		await createServerClient(connection, options).debug.location.evict({
			location: { directory },
		});
	};
}

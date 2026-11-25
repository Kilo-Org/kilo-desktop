import type { ServerConnection } from "../../contracts";
import { createServerClient } from "../server-client";

export type LocationEvictor = (connection: ServerConnection, directory: string) => Promise<void>;

/**
 * Shuts down the Kilo v2 server's location for one directory, which stops the
 * MCP servers, file watcher and other processes it runs there. Windows
 * refuses to rename or delete a directory that is some process's working
 * directory, so a worktree must be released this way before it can be
 * removed.
 *
 * v2's `debug.location.evict` answers once the location has shut down (its
 * `location.shutdown` event comes first), and succeeds for a directory with no
 * location loaded, so nothing needs to wait on the event stream.
 */
export function createLocationEvictor(
	options: { fetch?: typeof globalThis.fetch } = {},
): LocationEvictor {
	return async (connection, directory) => {
		const client = createServerClient(connection, options.fetch ?? globalThis.fetch);
		await client.debug.location.evict({ location: { directory } });
	};
}

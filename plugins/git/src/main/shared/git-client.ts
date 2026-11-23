import type { KernelLogger } from "@kilo-desktop/kernel";
import { createGitClient, type GitClient } from "@kilo-desktop/git-client";

/** `GitClient` minus what kilo.git does not use; new `GitClient` members join the slice automatically. */
export type GitClientSlice = Omit<GitClient, "path" | "satisfies" | "symbolicRef">;

/**
 * kilo.git's git client. The entry makes one and hands it to every area, so
 * git's binary lookup and version check run once per launch.
 */
export function createDefaultGitClient(logger: KernelLogger): GitClientSlice {
	// git-client's `GitLogger` is the narrow `{ error }` interface, which
	// `KernelLogger` satisfies directly.
	return createGitClient({ logger });
}

/** `client`, each of whose (async) methods first waits for `ready`. */
export function afterEnvironment<Client extends object>(
	client: Client,
	ready: () => Promise<void>,
): Client {
	return new Proxy(client, {
		get(target, prop, receiver) {
			const value: unknown = Reflect.get(target, prop, receiver);
			if (typeof value !== "function") return value;
			return async (...args: unknown[]) => {
				await ready();
				return Reflect.apply(value, target, args);
			};
		},
	});
}

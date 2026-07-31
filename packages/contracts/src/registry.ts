import { authEvents, authMethods } from "./features/auth.js";
import { featureMethods } from "./features/feature-invoke.js";
import { shellMethods } from "./features/shell.js";
import { themeEvents, themeMethods } from "./features/theme.js";
import { todoMethods } from "./features/todos.js";

/**
 * Throws if any two channel maps share a key. A plain object spread already
 * merges maps with the correct per-channel type; this only adds the one thing a
 * spread cannot — detecting a channel-name collision between features instead
 * of silently letting the last one win.
 */
export function assertNoDuplicateChannels(...parts: Array<Record<string, unknown>>): void {
	const seen = new Set<string>();
	for (const part of parts) {
		for (const key of Object.keys(part)) {
			if (seen.has(key)) {
				throw new Error(`Duplicate IPC channel key: ${key}`);
			}
			seen.add(key);
		}
	}
}

assertNoDuplicateChannels(shellMethods, themeMethods, todoMethods, authMethods, featureMethods);
assertNoDuplicateChannels(themeEvents, authEvents);

export const ipcMethods = {
	...shellMethods,
	...themeMethods,
	...todoMethods,
	...authMethods,
	...featureMethods,
};
export const ipcEvents = { ...themeEvents, ...authEvents };

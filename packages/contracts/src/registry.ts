import { authEvents, authMethods } from "./features/auth.js";
import { featureEvents, featureMessages } from "./features/feature-event.js";
import { featureFlagEvents, featureFlagMethods } from "./features/feature-flag.js";
import { featureMethods } from "./features/feature-invoke.js";
import { featurePorts } from "./features/feature-port.js";
import { fsMethods } from "./features/fs.js";
import { notificationsMethods } from "./features/notifications.js";
import { shellMethods } from "./features/shell.js";
import { themeMethods } from "./features/theme.js";

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

assertNoDuplicateChannels(
	shellMethods,
	themeMethods,
	authMethods,
	featureMethods,
	notificationsMethods,
	fsMethods,
	featureFlagMethods,
);
assertNoDuplicateChannels(featureEvents, authEvents, featureFlagEvents);
assertNoDuplicateChannels(featureMessages);
assertNoDuplicateChannels(featurePorts);

export const ipcMethods = {
	...shellMethods,
	...themeMethods,
	...authMethods,
	...featureMethods,
	...notificationsMethods,
	...fsMethods,
	...featureFlagMethods,
};
export const ipcEvents = { ...authEvents, ...featureEvents, ...featureFlagEvents };
// feature:event is intentionally duplex: the same validated envelope is a
// renderer-to-main message and a main-to-renderer event.
export const ipcMessages = { ...featureMessages };
export const ipcPorts = { ...featurePorts };

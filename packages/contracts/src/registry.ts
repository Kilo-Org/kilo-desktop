import { authEvents, authMethods } from "./features/auth.js";
import { featureEvents, featureMessages } from "./features/feature-event.js";
import { featureFlagEvents, featureFlagMethods } from "./features/feature-flag.js";
import { featureMethods } from "./features/feature-invoke.js";
import { featurePorts } from "./features/feature-port.js";
import { fsMethods } from "./features/fs.js";
import { notificationsMethods } from "./features/notifications.js";
import { shellEvents, shellMethods } from "./features/shell.js";
import { shortcutsEvents, shortcutsMessages } from "./features/shortcuts.js";
import { telemetryMethods } from "./features/telemetry.js";
import { themeMethods } from "./features/theme.js";
import { updateEvents, updateMethods } from "./features/updates.js";

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
	telemetryMethods,
	updateMethods,
);
assertNoDuplicateChannels(
	shellEvents,
	featureEvents,
	authEvents,
	featureFlagEvents,
	updateEvents,
	shortcutsEvents,
);
assertNoDuplicateChannels(featureMessages, shortcutsMessages);
assertNoDuplicateChannels(featurePorts);
assertNoDuplicateChannels(featurePorts, {
	...shellMethods,
	...themeMethods,
	...authMethods,
	...featureMethods,
	...notificationsMethods,
	...fsMethods,
	...featureFlagMethods,
	...updateMethods,
	...shellEvents,
	...authEvents,
	...featureEvents,
	...featureFlagEvents,
	...updateEvents,
	...shortcutsEvents,
	...featureMessages,
	...shortcutsMessages,
});

export const ipcMethods = {
	...shellMethods,
	...themeMethods,
	...authMethods,
	...telemetryMethods,
	...featureMethods,
	...notificationsMethods,
	...fsMethods,
	...featureFlagMethods,
	...updateMethods,
};
export const ipcEvents = {
	...shellEvents,
	...authEvents,
	...featureEvents,
	...featureFlagEvents,
	...updateEvents,
	...shortcutsEvents,
};
// feature:event is intentionally duplex: the same validated envelope is a
// renderer-to-main message and a main-to-renderer event.
export const ipcMessages = { ...featureMessages, ...shortcutsMessages };
export const ipcPorts = { ...featurePorts };

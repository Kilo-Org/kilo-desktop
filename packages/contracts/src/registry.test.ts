import { describe, expect, it } from "vitest";

import { authEvents, authMethods } from "./features/auth.js";
import { featureEvents, featureMessages } from "./features/feature-event.js";
import { featureFlagEvents, featureFlagMethods } from "./features/feature-flag.js";
import { featureMethods } from "./features/feature-invoke.js";
import { featurePorts } from "./features/feature-port.js";
import { fsMethods } from "./features/fs.js";
import { notificationsMethods } from "./features/notifications.js";
import { shellMethods } from "./features/shell.js";
import { telemetryMethods } from "./features/telemetry.js";
import { themeMethods } from "./features/theme.js";
import {
	assertNoDuplicateChannels,
	ipcEvents,
	ipcMessages,
	ipcMethods,
	ipcPorts,
} from "./registry.js";

describe("IPC registry", () => {
	it("merged method channel count equals the sum of feature parts", () => {
		expect(Object.keys(ipcMethods)).toHaveLength(
			Object.keys(shellMethods).length +
				Object.keys(themeMethods).length +
				Object.keys(authMethods).length +
				Object.keys(featureMethods).length +
				Object.keys(notificationsMethods).length +
				Object.keys(fsMethods).length +
				Object.keys(featureFlagMethods).length +
				Object.keys(telemetryMethods).length,
		);
	});

	it("merged event channel count equals the sum of feature parts", () => {
		expect(Object.keys(ipcEvents)).toHaveLength(
			Object.keys(authEvents).length +
				Object.keys(featureEvents).length +
				Object.keys(featureFlagEvents).length,
		);
		expect(Object.keys(ipcMessages)).toHaveLength(Object.keys(featureMessages).length);
		expect(Object.keys(ipcPorts)).toHaveLength(Object.keys(featurePorts).length);
	});

	it("throws on duplicate channel keys", () => {
		expect(() => assertNoDuplicateChannels({ "demo:list": 1 }, { "demo:list": 2 })).toThrow(
			"Duplicate IPC channel key: demo:list",
		);
	});
});

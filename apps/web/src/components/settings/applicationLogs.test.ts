import { describe, expect, it } from "vitest";

import { getShowLogFileLabel } from "./applicationLogs";

describe("getShowLogFileLabel", () => {
	it.each([
		["MacIntel", "Show in Finder"],
		["Win32", "Show in File Explorer"],
		["Linux x86_64", "Show in File Manager"],
	])("uses the native file manager name for %s", (platform, label) => {
		expect(getShowLogFileLabel(platform)).toBe(label);
	});
});

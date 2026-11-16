import { describe, expect, it } from "vitest";

import { revealInFileManagerLabel } from "./reveal-in-file-manager";

describe("revealInFileManagerLabel", () => {
	it.each([
		["MacIntel", "Show in Finder"],
		["Win32", "Show in File Explorer"],
		["Linux x86_64", "Show in File Manager"],
		["", "Show in File Manager"],
	])("uses the native file manager name for %j", (platform, label) => {
		expect(revealInFileManagerLabel(platform)).toBe(label);
	});
});

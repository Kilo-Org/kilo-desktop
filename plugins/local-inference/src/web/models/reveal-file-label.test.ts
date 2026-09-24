import { describe, expect, it } from "vitest";

import { revealInFileManagerLabel } from "./reveal-file-label.js";

describe("revealInFileManagerLabel", () => {
	it("uses Explorer on Windows", () => {
		expect(revealInFileManagerLabel("Win32")).toBe("Show in Explorer");
	});

	it("uses Files on Linux", () => {
		expect(revealInFileManagerLabel("Linux x86_64")).toBe("Show in Files");
	});

	it("uses Finder on macOS and other platforms", () => {
		expect(revealInFileManagerLabel("MacIntel")).toBe("Show in Finder");
		expect(revealInFileManagerLabel("")).toBe("Show in Finder");
	});
});

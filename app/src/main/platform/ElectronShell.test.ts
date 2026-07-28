import { beforeEach, describe, expect, it, vi } from "vitest";

const { openExternal, writeText } = vi.hoisted(() => ({
	openExternal: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("electron", () => ({
	clipboard: { writeText },
	shell: { openExternal },
}));

import { ElectronShell, parseSafeExternalUrl } from "./ElectronShell.js";

describe("ElectronShell", () => {
	beforeEach(() => {
		openExternal.mockReset();
		writeText.mockReset();
	});

	it.each([
		["https://anaconda.com", "https://anaconda.com/"],
		["http://localhost:5173/path", "http://localhost:5173/path"],
	])("accepts safe external URL %s", (input, expected) => {
		expect(parseSafeExternalUrl(input)).toBe(expected);
	});

	it.each(["javascript:alert(1)", "file:///tmp/secret", "anaconda-desktop://app/", "bad"])(
		"rejects unsafe URL %s",
		(input) => {
			expect(parseSafeExternalUrl(input)).toBeUndefined();
		},
	);

	it("opens safe URLs and reports failures", async () => {
		openExternal.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("blocked"));
		const adapter = new ElectronShell();
		await expect(adapter.openExternal("https://anaconda.com")).resolves.toBe(true);
		await expect(adapter.openExternal("https://anaconda.com")).resolves.toBe(false);
		expect(openExternal).toHaveBeenCalledTimes(2);
	});

	it("writes text without exposing clipboard reads", () => {
		const adapter = new ElectronShell();
		adapter.copyText("λ Anaconda");
		expect(writeText).toHaveBeenCalledWith("λ Anaconda");
		expect("readText" in adapter).toBe(false);
	});
});

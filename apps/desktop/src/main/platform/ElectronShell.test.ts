import { beforeEach, describe, expect, it, vi } from "vitest";

const { openExternal, showItemInFolder, writeText } = vi.hoisted(() => ({
	openExternal: vi.fn(),
	showItemInFolder: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("electron", () => ({
	clipboard: { writeText },
	shell: { openExternal, showItemInFolder },
}));

import { ElectronShell, parseSafeExternalUrl } from "./ElectronShell.js";

describe("ElectronShell", () => {
	beforeEach(() => {
		openExternal.mockReset();
		showItemInFolder.mockReset();
		writeText.mockReset();
	});

	it.each([
		["https://anaconda.com", "https://anaconda.com/"],
		["http://localhost:5173/path", "http://localhost:5173/path"],
	])("accepts safe external URL %s", (input, expected) => {
		expect(parseSafeExternalUrl(input)).toBe(expected);
	});

	it.each(["javascript:alert(1)", "file:///tmp/secret", "kilo-desktop://app/", "bad"])(
		"rejects unsafe URL %s",
		(input) => {
			expect(parseSafeExternalUrl(input)).toBeUndefined();
		},
	);

	it("rejects non-string external URLs", () => {
		expect(parseSafeExternalUrl(undefined)).toBeUndefined();
		expect(parseSafeExternalUrl(42)).toBeUndefined();
		expect(parseSafeExternalUrl({ href: "https://anaconda.com" })).toBeUndefined();
	});

	it("opens safe URLs and reports failures", async () => {
		openExternal.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("blocked"));
		const adapter = new ElectronShell();
		await expect(adapter.openExternal("https://anaconda.com")).resolves.toBe(true);
		await expect(adapter.openExternal("https://anaconda.com")).resolves.toBe(false);
		await expect(adapter.openExternal("javascript:alert(1)")).resolves.toBe(false);
		expect(openExternal).toHaveBeenCalledTimes(2);
	});

	it("writes text without exposing clipboard reads", () => {
		const adapter = new ElectronShell();
		adapter.copyText("λ Anaconda");
		expect(writeText).toHaveBeenCalledWith("λ Anaconda");
		expect("readText" in adapter).toBe(false);
	});

	it("reveals valid file paths in the native file manager", () => {
		const adapter = new ElectronShell();

		expect(adapter.showItemInFolder("/models/tiny.gguf")).toBe(true);
		expect(adapter.showItemInFolder("model\n.gguf")).toBe(false);
		showItemInFolder.mockImplementationOnce(() => {
			throw new Error("unavailable");
		});
		expect(adapter.showItemInFolder("/models/missing.gguf")).toBe(false);
		expect(showItemInFolder).toHaveBeenCalledTimes(2);
		expect(showItemInFolder).toHaveBeenCalledWith("/models/tiny.gguf");
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getAllWindows,
	getFocusedWindow,
	openExternal,
	parentWindow,
	showOpenDialog,
	showSaveDialog,
	writeText,
} = vi.hoisted(() => ({
	getAllWindows: vi.fn(),
	getFocusedWindow: vi.fn(),
	openExternal: vi.fn(),
	parentWindow: {},
	showOpenDialog: vi.fn(),
	showSaveDialog: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows, getFocusedWindow },
	clipboard: { writeText },
	dialog: { showOpenDialog, showSaveDialog },
	shell: { openExternal },
}));

import { ElectronShell, parseSafeExternalUrl } from "./ElectronShell.js";

describe("ElectronShell", () => {
	beforeEach(() => {
		openExternal.mockReset();
		writeText.mockReset();
		showOpenDialog.mockReset();
		showSaveDialog.mockReset();
		getFocusedWindow.mockReset().mockReturnValue(parentWindow);
		getAllWindows.mockReset().mockReturnValue([]);
	});

	it("parents save dialogs to the renderer that requested them", async () => {
		const requestingWindow = { webContents: { id: 73 } };
		getAllWindows.mockReturnValue([requestingWindow]);
		showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/analysis.ipynb" });
		const adapter = new ElectronShell();

		await expect(
			adapter.showSaveFileDialog(73, {
				defaultPath: "/tmp/analysis.ipynb",
				filters: [{ name: "Documents", extensions: ["txt"] }],
			}),
		).resolves.toBe("/tmp/analysis.ipynb");
		expect(showSaveDialog).toHaveBeenCalledWith(requestingWindow, {
			defaultPath: "/tmp/analysis.ipynb",
			filters: [{ name: "Documents", extensions: ["txt"] }],
		});
	});

	it("maps directory dialog options and results", async () => {
		showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/one", "/tmp/two"] });
		const adapter = new ElectronShell();
		await expect(adapter.showOpenDialog({ kind: "directory", multiple: true })).resolves.toEqual({
			canceled: false,
			paths: ["/tmp/one", "/tmp/two"],
		});
		expect(showOpenDialog).toHaveBeenCalledWith(parentWindow, {
			properties: ["openDirectory", "multiSelections"],
		});
	});

	it("uses the first app window when no window is focused", async () => {
		getFocusedWindow.mockReturnValue(undefined);
		getAllWindows.mockReturnValue([parentWindow]);
		showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
		const adapter = new ElectronShell();

		await adapter.showOpenDialog({ kind: "directory" });

		expect(showOpenDialog).toHaveBeenCalledWith(parentWindow, {
			properties: ["openDirectory"],
		});
	});

	it("falls back to an unparented dialog when no app window is available", async () => {
		getFocusedWindow.mockReturnValue(undefined);
		showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
		const adapter = new ElectronShell();

		await adapter.showOpenDialog({ kind: "directory" });

		expect(showOpenDialog).toHaveBeenCalledWith({ properties: ["openDirectory"] });
	});

	it.each([
		["https://anaconda.com", "https://anaconda.com/"],
		["http://localhost:5173/path", "http://localhost:5173/path"],
	])("accepts safe external URL %s", (input, expected) => {
		expect(parseSafeExternalUrl(input)).toBe(expected);
	});

	it.each(["javascript:alert(1)", "file:///tmp/secret", "anaconda-agentic-desktop://app/", "bad"])(
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
});

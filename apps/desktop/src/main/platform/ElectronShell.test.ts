import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getAllWindows,
	getFocusedWindow,
	openExternal,
	parentWindow,
	showItemInFolder,
	showOpenDialog,
	showSaveDialog,
	writeText,
} = vi.hoisted(() => ({
	getAllWindows: vi.fn(),
	getFocusedWindow: vi.fn(),
	openExternal: vi.fn(),
	parentWindow: {},
	showItemInFolder: vi.fn(),
	showOpenDialog: vi.fn(),
	showSaveDialog: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows, getFocusedWindow },
	clipboard: { writeText },
	dialog: { showOpenDialog, showSaveDialog },
	shell: { openExternal, showItemInFolder },
}));

import { ElectronShell, parseSafeExternalUrl } from "./ElectronShell.js";

describe("ElectronShell", () => {
	beforeEach(() => {
		openExternal.mockReset();
		showItemInFolder.mockReset();
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

	it("returns null when the save dialog is canceled or yields no path", async () => {
		showSaveDialog
			.mockResolvedValueOnce({ canceled: true, filePath: "/tmp/ignored.txt" })
			.mockResolvedValueOnce({ canceled: false });
		const adapter = new ElectronShell();

		await expect(adapter.showSaveFileDialog(1)).resolves.toBeNull();
		await expect(adapter.showSaveFileDialog(1)).resolves.toBeNull();
		expect(showSaveDialog).toHaveBeenCalledWith(parentWindow, {});
	});

	it("shows an unparented save dialog when no app window exists", async () => {
		getFocusedWindow.mockReturnValue(undefined);
		showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/out.txt" });
		const adapter = new ElectronShell();

		await expect(adapter.showSaveFileDialog(5)).resolves.toBe("/tmp/out.txt");
		expect(showSaveDialog).toHaveBeenCalledWith({});
	});

	it("parents open-file dialogs to the requesting renderer and maps options", async () => {
		const otherWindow = { webContents: { id: 1 } };
		const requestingWindow = { webContents: { id: 42 } };
		getAllWindows.mockReturnValue([otherWindow, requestingWindow]);
		showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/a.csv", "/tmp/b.csv"] });
		const adapter = new ElectronShell();

		await expect(
			adapter.showOpenFileDialog(42, {
				defaultPath: "/tmp",
				filters: [{ name: "CSV", extensions: ["csv", "tsv"] }],
			}),
		).resolves.toBe("/tmp/a.csv");
		expect(showOpenDialog).toHaveBeenCalledWith(requestingWindow, {
			properties: ["openFile"],
			defaultPath: "/tmp",
			filters: [{ name: "CSV", extensions: ["csv", "tsv"] }],
		});
	});

	it("falls back to the focused window, then unparented, for open-file dialogs", async () => {
		showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
		const adapter = new ElectronShell();

		await expect(adapter.showOpenFileDialog(99)).resolves.toBeNull();
		expect(showOpenDialog).toHaveBeenLastCalledWith(parentWindow, { properties: ["openFile"] });

		getFocusedWindow.mockReturnValue(undefined);
		showOpenDialog.mockResolvedValue({ canceled: true, filePaths: ["/tmp/ignored"] });
		await expect(adapter.showOpenFileDialog(99)).resolves.toBeNull();
		expect(showOpenDialog).toHaveBeenLastCalledWith({ properties: ["openFile"] });
	});

	it("maps directory dialog options and results", async () => {
		showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/one", "/tmp/two"] });
		const adapter = new ElectronShell();
		await expect(adapter.showOpenDialog({ kind: "directory", multiple: true })).resolves.toEqual({
			canceled: false,
			paths: ["/tmp/one", "/tmp/two"],
		});
		expect(showOpenDialog).toHaveBeenCalledWith(parentWindow, {
			properties: ["openDirectory", "createDirectory", "multiSelections"],
		});
	});

	it("uses the first app window when no window is focused", async () => {
		getFocusedWindow.mockReturnValue(undefined);
		getAllWindows.mockReturnValue([parentWindow]);
		showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
		const adapter = new ElectronShell();

		await adapter.showOpenDialog({ kind: "directory" });

		expect(showOpenDialog).toHaveBeenCalledWith(parentWindow, {
			properties: ["openDirectory", "createDirectory"],
		});
	});

	it("falls back to an unparented dialog when no app window is available", async () => {
		getFocusedWindow.mockReturnValue(undefined);
		showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
		const adapter = new ElectronShell();

		await adapter.showOpenDialog({ kind: "directory" });

		expect(showOpenDialog).toHaveBeenCalledWith({
			properties: ["openDirectory", "createDirectory"],
		});
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

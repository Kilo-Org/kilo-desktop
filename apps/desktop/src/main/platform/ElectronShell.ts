import {
	BrowserWindow,
	clipboard,
	dialog,
	shell,
	type Clipboard,
	type Dialog,
	type OpenDialogOptions,
	type SaveDialogOptions,
	type Shell,
} from "electron";

import type { MainSdkHostDialogOptions } from "@kilo-desktop/feature-sdk";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export function parseSafeExternalUrl(rawUrl: unknown): string | undefined {
	if (typeof rawUrl !== "string") return undefined;
	try {
		const url = new URL(rawUrl);
		return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : undefined;
	} catch {
		return undefined;
	}
}

export class ElectronShell {
	constructor(
		private readonly electronShell: Shell = shell,
		private readonly electronClipboard: Clipboard = clipboard,
		private readonly electronDialog: Dialog = dialog,
	) {}

	async openExternal(rawUrl: unknown): Promise<boolean> {
		const url = parseSafeExternalUrl(rawUrl);
		if (!url) return false;
		try {
			await this.electronShell.openExternal(url);
			return true;
		} catch {
			return false;
		}
	}

	copyText(text: string): void {
		this.electronClipboard.writeText(text);
	}

	showItemInFolder(filePath: string): boolean {
		if (!filePath || /[\r\n]/.test(filePath)) return false;
		try {
			this.electronShell.showItemInFolder(filePath);
			return true;
		} catch {
			return false;
		}
	}

	async showOpenDialog(options: {
		kind: "directory";
		multiple?: boolean | undefined;
	}): Promise<{ canceled: boolean; paths: string[] }> {
		const properties: OpenDialogOptions["properties"] = ["openDirectory"];
		if (options.multiple) properties.push("multiSelections");
		const dialogOptions = { properties } satisfies OpenDialogOptions;
		const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		const result = parentWindow
			? await this.electronDialog.showOpenDialog(parentWindow, dialogOptions)
			: await this.electronDialog.showOpenDialog(dialogOptions);
		return { canceled: result.canceled, paths: result.filePaths };
	}

	async showOpenFileDialog(
		senderId: number,
		options?: MainSdkHostDialogOptions,
	): Promise<string | null> {
		const dialogOptions: OpenDialogOptions = {
			properties: ["openFile"],
			...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
			...(options?.filters
				? {
						filters: options.filters.map((filter) => ({
							name: filter.name,
							extensions: [...filter.extensions],
						})),
					}
				: {}),
		};
		const parentWindow = this.#windowForSender(senderId);
		const result = parentWindow
			? await this.electronDialog.showOpenDialog(parentWindow, dialogOptions)
			: await this.electronDialog.showOpenDialog(dialogOptions);
		return result.canceled ? null : (result.filePaths[0] ?? null);
	}

	async showSaveFileDialog(
		senderId: number,
		options?: MainSdkHostDialogOptions,
	): Promise<string | null> {
		const dialogOptions: SaveDialogOptions = {
			...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
			...(options?.filters
				? {
						filters: options.filters.map((filter) => ({
							name: filter.name,
							extensions: [...filter.extensions],
						})),
					}
				: {}),
		};
		const parentWindow = this.#windowForSender(senderId);
		const result = parentWindow
			? await this.electronDialog.showSaveDialog(parentWindow, dialogOptions)
			: await this.electronDialog.showSaveDialog(dialogOptions);
		return result.canceled ? null : (result.filePath ?? null);
	}

	#windowForSender(senderId: number): BrowserWindow | undefined {
		return (
			BrowserWindow.getAllWindows().find((window) => window.webContents.id === senderId) ??
			BrowserWindow.getFocusedWindow() ??
			BrowserWindow.getAllWindows()[0]
		);
	}
}

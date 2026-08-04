import {
	clipboard,
	dialog,
	shell,
	type Clipboard,
	type Dialog,
	type OpenDialogOptions,
	type Shell,
} from "electron";

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

	async showOpenDialog(options: {
		kind: "directory";
		multiple?: boolean | undefined;
	}): Promise<{ canceled: boolean; paths: string[] }> {
		const properties: OpenDialogOptions["properties"] = ["openDirectory"];
		if (options.multiple) properties.push("multiSelections");
		const result = await this.electronDialog.showOpenDialog({ properties });
		return { canceled: result.canceled, paths: result.filePaths };
	}
}

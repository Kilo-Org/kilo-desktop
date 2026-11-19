import { clipboard, shell, type Clipboard, type Shell } from "electron";

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
}

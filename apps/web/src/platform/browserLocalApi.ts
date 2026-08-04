import {
	LocalApiError,
	type AuthSession,
	type LocalApi,
} from "@anaconda-agentic-desktop/contracts";

export function createBrowserLocalApi(): LocalApi {
	return {
		theme: {
			// No native chrome to paint outside Electron — the page owns its theme.
			async sync() {},
		},
		shell: {
			async openExternal(input) {
				const opened = globalThis.open(input.url, "_blank", "noopener,noreferrer");
				if (!opened) {
					throw new LocalApiError("TRANSPORT", "Could not open the external URL.");
				}
				return { opened: true };
			},
			async copyText(input) {
				try {
					await navigator.clipboard.writeText(input.text);
				} catch {
					throw new LocalApiError("TRANSPORT", "Could not copy text to the clipboard.");
				}
			},
			async showOpenDialog() {
				throw new LocalApiError("TRANSPORT", "Folder selection requires the desktop app.");
			},
			getPathForFile() {
				return null;
			},
		},
		auth: {
			async getSession(): Promise<AuthSession> {
				// No keyring in the browser — always anonymous.
				return { status: "anonymous" };
			},
			async refresh(): Promise<AuthSession> {
				return { status: "anonymous" };
			},
			async login(): Promise<AuthSession> {
				// No keyring/OAuth in browser mode — stay anonymous.
				return { status: "anonymous" };
			},
			async logout(): Promise<AuthSession> {
				return { status: "anonymous" };
			},
			onChanged() {
				// Session never changes in browser mode.
				return () => {};
			},
		},
	};
}

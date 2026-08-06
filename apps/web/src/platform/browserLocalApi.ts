import {
	LocalApiError,
	type AuthSession,
	type LocalApi,
} from "@anaconda-agentic-desktop/contracts";

async function browserFsUnavailable(): Promise<never> {
	throw new LocalApiError(
		"TRANSPORT",
		"sdk.fs is not available in browser mode — there is no filesystem sandbox.",
	);
}

export function createBrowserLocalApi(): LocalApi {
	return {
		theme: {
			// No native chrome to paint outside Electron — the page owns its theme.
			async sync() {},
		},
		shell: {
			canPickDirectories: false,
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
		notifications: {
			// Web Notification API, permission-gated. Never request permission
			// here (no surprise prompts) — report undelivered honestly instead.
			async show(input) {
				if (typeof Notification === "undefined") {
					return {
						delivered: false,
						reason: "Notifications are not supported in this browser.",
					};
				}
				if (Notification.permission !== "granted") {
					return {
						delivered: false,
						reason: "Notification permission has not been granted in this browser.",
					};
				}
				try {
					new Notification(input.title, { body: input.message });
					return { delivered: true };
				} catch {
					// Some platforms require ServiceWorkerRegistration.showNotification
					// and throw from the constructor even when permission is granted.
					return { delivered: false, reason: "The notification could not be shown." };
				}
			},
			async setBadge(input) {
				// Badging API — not yet in lib.dom, hence the structural probe.
				const badging = navigator as Navigator & {
					setAppBadge?: (count: number) => Promise<void>;
				};
				if (typeof badging.setAppBadge !== "function") {
					return {
						delivered: false,
						reason: "App badges are not supported in this browser.",
					};
				}
				try {
					await badging.setAppBadge(input.count);
					return { delivered: true };
				} catch {
					return { delivered: false, reason: "The app badge could not be set." };
				}
			},
		},
		fs: {
			// No filesystem in browser mode — sdk.fs is a detectable capability,
			// not a given (mirrors mainSdk.storageDir being Electron-only).
			readFile: browserFsUnavailable,
			writeFile: browserFsUnavailable,
			exists: browserFsUnavailable,
			mkdir: browserFsUnavailable,
			readdir: browserFsUnavailable,
			remove: browserFsUnavailable,
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
		featureFlags: {
			// No flag provider in browser mode — every flag falls back to its default.
			async getFlag(_key, defaultValue) {
				return defaultValue;
			},
			async getAllFlags() {
				return {};
			},
			onChanged() {
				return () => {};
			},
		},
	};
}

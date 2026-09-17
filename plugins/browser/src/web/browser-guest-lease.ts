import type { ElectronWebview } from "./browser-types.js";

const RELEASE_DELAY_MS = 1_000;
const WEBVIEW_PREFERENCES =
	"sandbox=true,contextIsolation=true,nodeIntegration=false,allowRunningInsecureContent=false";

type GuestEntry = {
	host: HTMLDivElement;
	webview: ElectronWebview;
	references: number;
	releaseTimer: number | undefined;
};

export type BrowserGuestLease = GuestEntry & { release(): void };

const guests = new Map<string, GuestEntry>();

function createGuest(instanceId: string, partition: string, src: string): GuestEntry {
	const host = document.createElement("div");
	host.dataset.browserWebviewHost = instanceId;
	Object.assign(host.style, { position: "fixed", overflow: "hidden", zIndex: "20" });
	const webview = document.createElement("webview") as ElectronWebview;
	webview.setAttribute("src", src);
	webview.setAttribute("partition", partition);
	webview.setAttribute("webpreferences", WEBVIEW_PREFERENCES);
	webview.className = "size-full";
	webview.dataset.qaId = "browser-webview";
	host.append(webview);
	document.body.append(host);
	return { host, webview, references: 0, releaseTimer: undefined };
}

export function acquireBrowserGuest(
	instanceId: string,
	partition: string,
	src: string,
): BrowserGuestLease {
	const entry = guests.get(instanceId) ?? createGuest(instanceId, partition, src);
	if (entry.releaseTimer !== undefined) window.clearTimeout(entry.releaseTimer);
	entry.releaseTimer = undefined;
	entry.references += 1;
	entry.host.style.display = "block";
	guests.set(instanceId, entry);
	let released = false;
	return {
		...entry,
		release() {
			if (released) return;
			released = true;
			entry.references = Math.max(0, entry.references - 1);
			if (entry.references > 0) return;
			entry.host.style.display = "none";
			entry.releaseTimer = window.setTimeout(() => {
				if (entry.references > 0 || guests.get(instanceId) !== entry) return;
				guests.delete(instanceId);
				entry.host.remove();
			}, RELEASE_DELAY_MS);
		},
	};
}

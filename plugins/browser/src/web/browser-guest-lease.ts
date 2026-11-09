import type { ElectronWebview } from "./browser-types.js";

const RELEASE_DELAY_MS = 1_000;
// <webview> guests have a transparent canvas, but pages assume the opaque white
// canvas a top-level browser tab provides; without it the app's themed pane
// surface shows through wherever a page leaves its background unset.
const GUEST_CANVAS_COLOR = "#fff";
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

// Removing the host disconnects its child <webview>, which synchronously runs
// Electron's internal disconnectedCallback. When the guest's webContents was
// already torn down, that callback throws `Invalid guestInstanceId`. The node is
// detached regardless, so the error is a benign teardown race and must not escape
// the release timer as an unhandled renderer error.
function removeGuestHost(host: HTMLDivElement): void {
	try {
		host.remove();
	} catch {
		// Guest already destroyed; the host is detached either way.
	}
}

function createGuest(instanceId: string, partition: string, src: string): GuestEntry {
	const host = document.createElement("div");
	host.dataset.browserWebviewHost = instanceId;
	Object.assign(host.style, {
		position: "fixed",
		overflow: "hidden",
		zIndex: "20",
		backgroundColor: GUEST_CANVAS_COLOR,
	});
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
				removeGuestHost(entry.host);
			}, RELEASE_DELAY_MS);
		},
	};
}

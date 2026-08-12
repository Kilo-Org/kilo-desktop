import { useEffect, useRef } from "react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import { NTERACT_ELECTRON_HOST_PROTOCOL_VERSION, NOTEBOOK_HOST } from "../contracts/schemas.js";

/**
 * nteract's notebook UI is a private workspace app whose execution path needs
 * the `runtimed` daemon over its local transport. Electron transfers one
 * feature-scoped MessagePort into the frame; the daemon socket is never exposed
 * to either renderer.
 *
 * In the desktop app the bundle is served from its own protocol host, which
 * frames here. Browser mode has no custom protocol at all, so it still needs
 * `VITE_NTERACT_ORIGIN` pointing at nteract's dev server.
 */
/**
 * Matches both the production and `-dev` desktop schemes. Not imported from
 * main's `ElectronProtocol`, which the web app cannot reach; the prefix is all
 * this needs, and getting it wrong falls back to browser mode rather than
 * framing a wrong origin.
 */
const DESKTOP_SCHEME_PREFIX = "anaconda-agentic-desktop";

/** Legacy right-panel ids were `notebook.notebook:<uuid>`; runt expects a bare UUID. */
const LEGACY_NOTEBOOK_ID_PREFIX = "notebook.notebook:";

/**
 * Right-panel `instanceId` → daemon `notebook_id`. Strips the legacy
 * `notebook.notebook:` prefix so the iframe and nteract MCP share one room.
 */
export function notebookIdFromInstanceId(instanceId: string): string {
	return instanceId.startsWith(LEGACY_NOTEBOOK_ID_PREFIX)
		? instanceId.slice(LEGACY_NOTEBOOK_ID_PREFIX.length)
		: instanceId;
}

/**
 * The renderer cannot read `app.isPackaged`, so it cannot derive the scheme —
 * but it does not need to: its own origin already carries the right one, and
 * only the host differs. Returns undefined off the custom protocol (browser
 * mode), where the notebook host does not exist.
 */
export function notebookOriginFrom(appOrigin: string): string | undefined {
	let url: URL;
	try {
		url = new URL(appOrigin);
	} catch {
		return undefined;
	}
	if (!url.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) return undefined;
	// Assembled rather than read off `url.origin`, which is "null" for a scheme
	// the URL parser does not know is special.
	return `${url.protocol}//${NOTEBOOK_HOST}`;
}

export function appOriginFromLocation(location: Pick<Location, "protocol" | "host">): string {
	return `${location.protocol}//${location.host}`;
}

/** Read at render time, not module scope, so tests can drive both branches. */
export function nteractSrcFor(
	instanceId: string,
	location: Pick<Location, "protocol" | "host">,
	developmentOrigin?: string,
): string | undefined {
	const appOrigin = appOriginFromLocation(location);
	const origin = notebookOriginFrom(appOrigin) ?? developmentOrigin;
	if (!origin) return undefined;
	const url = new URL(origin);
	url.searchParams.set("notebook_id", notebookIdFromInstanceId(instanceId));
	if (url.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) {
		url.searchParams.set("nteract-host", "electron");
		url.searchParams.set("nteract-parent-origin", appOrigin);
	}
	return url.toString();
}

/** Read at render time, not module scope, so tests can drive browser configuration. */
export function nteractSrc(instanceId: string): string | undefined {
	return nteractSrcFor(
		instanceId,
		window.location,
		import.meta.env["VITE_NTERACT_ORIGIN"] as string | undefined,
	);
}

/** Context supplied by Kilo's `chat-right-panel-tab` extension point. */
export interface NotebookViewProps {
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
}

export function NotebookView({ instanceId, sessionId, title }: NotebookViewProps) {
	const sdk = useSdk("notebook");
	const frameRef = useRef<HTMLIFrameElement>(null);
	const frameSrc = nteractSrc(instanceId);

	useEffect(() => {
		if (!frameSrc) return;
		const frameUrl = new URL(frameSrc);
		if (!frameUrl.protocol.startsWith(DESKTOP_SCHEME_PREFIX)) return;
		const frameOrigin = `${frameUrl.protocol}//${frameUrl.host}`;

		const port = sdk.ports.open<MessagePort>("host", {
			notebookId: notebookIdFromInstanceId(instanceId),
			sessionId,
			title,
		});
		let transferred = false;
		const onMessage = (event: MessageEvent<unknown>) => {
			const frameWindow = frameRef.current?.contentWindow;
			if (event.source !== frameWindow || event.origin !== frameOrigin) return;
			const message = event.data as { type?: unknown; protocolVersion?: unknown } | null;
			if (
				message?.type !== "nteract:electron-host-ready" ||
				message.protocolVersion !== NTERACT_ELECTRON_HOST_PROTOCOL_VERSION ||
				transferred ||
				!frameWindow
			) {
				return;
			}
			transferred = true;
			frameWindow.postMessage(
				{
					type: "nteract:electron-host-connect",
					bootstrap: {
						protocolVersion: NTERACT_ELECTRON_HOST_PROTOCOL_VERSION,
						outputDocumentUrl: `${frameOrigin}/output-frame.html`,
					},
				},
				frameOrigin,
				[port],
			);
		};
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			if (!transferred) port.close();
		};
	}, [frameSrc, instanceId, sdk, sessionId, title]);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-qa-id="notebook-view">
			{frameSrc ? (
				// Deliberately no `sandbox` attribute. The isolation boundary here is the
				// separate protocol origin plus its CSP, not the sandbox: nteract needs
				// same-origin privileges for the loopback relay WebSocket and storage, and
				// `sandbox="allow-scripts allow-same-origin"` is a documented no-op — a frame
				// granted both can reach up and clear its own sandbox attribute. Adding one
				// would either break the notebook or buy nothing.
				<iframe
					ref={frameRef}
					src={frameSrc}
					title="nteract notebook"
					className="min-h-0 flex-1 border-0"
					allow="clipboard-read; clipboard-write; fullscreen"
					data-qa-id="notebook-frame"
				/>
			) : (
				<div
					className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm"
					data-qa-id="notebook-placeholder"
				>
					The notebook interface is not bundled in this build.
				</div>
			)}
		</div>
	);
}

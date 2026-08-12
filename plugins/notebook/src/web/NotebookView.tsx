import { NOTEBOOK_HOST } from "../contracts/schemas.js";

/**
 * nteract's notebook UI is a private workspace app whose execution path needs
 * the `runtimed` daemon over a Unix socket. The main process bridges that with a
 * loopback relay (NotebookRelayService) so nteract's stock browser host can
 * reach the daemon from inside Electron.
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

/** Read at render time, not module scope, so tests can drive both branches. */
export function nteractSrc(instanceId: string): string | undefined {
	const origin =
		notebookOriginFrom(window.location.origin) ??
		(import.meta.env["VITE_NTERACT_ORIGIN"] as string | undefined);
	if (!origin) return undefined;
	const url = new URL(origin);
	url.searchParams.set("notebook_id", instanceId);
	return url.toString();
}

/** Context supplied by Kilo's `chat-right-panel-tab` extension point. */
export interface NotebookViewProps {
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
}

export function NotebookView({ instanceId }: NotebookViewProps) {
	const frameSrc = nteractSrc(instanceId);

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

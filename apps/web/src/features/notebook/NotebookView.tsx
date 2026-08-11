import { NOTEBOOK_HOST } from "@anaconda-agentic-desktop/contracts";
import type { NotebookService, NotebookStatus } from "@anaconda-agentic-desktop/contracts";
import { useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

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
const DEFAULT_NOTEBOOK_PATH = "/tmp/ad-nb-python.ipynb";

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
function nteractSrc(notebookPath: string): string | undefined {
	const origin =
		notebookOriginFrom(window.location.origin) ??
		(import.meta.env["VITE_NTERACT_ORIGIN"] as string | undefined);
	if (!origin) return undefined;
	const url = new URL(origin);
	url.searchParams.set("path", notebookPath);
	return url.toString();
}

function daemonAbsenceMessage(availability: NotebookStatus["availability"]): string {
	return availability.reason ?? "The nteract runtime service is not running.";
}

export function NotebookView() {
	const sdk = useSdk<NotebookService>("notebook");
	const status = useSdkQuery(sdk, "status");
	const daemon = status.data?.daemon;
	const frameSrc = nteractSrc(DEFAULT_NOTEBOOK_PATH);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-qa-id="notebook-view">
			<div className="border-border flex items-center gap-3 border-b px-4 py-2">
				<div className="min-w-0 flex-1">
					<h1 className="text-sm font-medium">Notebook</h1>
					<p className="text-muted-foreground truncate text-xs" data-qa-id="notebook-status">
						{status.isLoading
							? "Connecting…"
							: status.isError || !status.data
								? "Notebook service unavailable."
								: daemon
									? `Daemon ${daemon.version} · relay port ${status.data?.relayPort}`
									: daemonAbsenceMessage(status.data.availability)}
					</p>
				</div>
			</div>
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

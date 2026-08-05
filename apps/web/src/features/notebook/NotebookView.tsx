import type { NotebookService, NotebookStatus } from "@anaconda-agentic-desktop/contracts";
import { useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

/**
 * nteract's notebook UI is a private workspace app whose execution path needs
 * the `runtimed` daemon over a Unix socket. The main process bridges that with a
 * loopback relay (NotebookRelayService) so nteract's stock browser host can
 * reach the daemon from inside Electron.
 *
 * The relay's client is nteract's own bundle, which we do not serve from our
 * protocol yet. Until then this view reports relay and daemon reachability, and
 * frames nteract's dev server when one is configured — the iframe loads only in
 * development, where the CSP grants the Vite origin.
 */
const DEFAULT_NOTEBOOK_PATH = "/tmp/ad-nb-python.ipynb";

/** Read at render time, not module scope, so tests can drive both branches. */
function nteractSrc(notebookPath: string): string | undefined {
	const origin: string | undefined = import.meta.env["VITE_NTERACT_ORIGIN"];
	if (!origin) return undefined;
	const url = new URL(origin);
	url.searchParams.set("path", notebookPath);
	return url.toString();
}

/**
 * Why no daemon is reachable. A `failed` supervisor carries the reason (no
 * bundled sidecar, a spawn error, an exhausted restart budget); the other states
 * are transient, so they read as progress rather than as an error.
 */
function daemonAbsenceMessage(process: NotebookStatus["process"]): string {
	if (process.status === "failed") {
		return `Daemon unavailable: ${process.reason ?? "the notebook daemon could not be started."}`;
	}
	if (process.status === "incompatible") {
		return `A different notebook daemon is already running (${process.runningVersion ?? "unknown"}); this app needs ${process.bundledVersion ?? "its bundled version"}.`;
	}
	if (process.status === "starting") return "Starting the notebook daemon…";
	if (process.status === "restarting") return "Restarting the notebook daemon…";
	return "Daemon not running.";
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
									: daemonAbsenceMessage(status.data.process)}
					</p>
				</div>
			</div>
			{frameSrc ? (
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
					The notebook interface is not bundled yet.
				</div>
			)}
		</div>
	);
}

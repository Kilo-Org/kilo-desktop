import type { NotebookService } from "@anaconda-agentic-desktop/contracts";
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
const NTERACT_ORIGIN: string | undefined = import.meta.env["VITE_NTERACT_ORIGIN"];
const DEFAULT_NOTEBOOK_PATH = "/tmp/ad-nb-python.ipynb";

function buildSrc(origin: string, notebookPath: string): string {
	const url = new URL(origin);
	url.searchParams.set("path", notebookPath);
	return url.toString();
}

export function NotebookView() {
	const sdk = useSdk<NotebookService>("notebook");
	const status = useSdkQuery(sdk, "status");
	const daemon = status.data?.daemon;

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-qa-id="notebook-view">
			<div className="border-border flex items-center gap-3 border-b px-4 py-2">
				<div className="min-w-0 flex-1">
					<h1 className="text-sm font-medium">Notebook</h1>
					<p className="text-muted-foreground truncate text-xs" data-qa-id="notebook-status">
						{status.isLoading
							? "Connecting…"
							: status.isError
								? "Notebook service unavailable."
								: daemon
									? `Daemon ${daemon.version} · relay port ${status.data?.relayPort}`
									: "Daemon not running."}
					</p>
				</div>
			</div>
			{NTERACT_ORIGIN ? (
				<iframe
					src={buildSrc(NTERACT_ORIGIN, DEFAULT_NOTEBOOK_PATH)}
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

import { useState } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";

/**
 * nteract's notebook UI is a private workspace app (`apps/notebook`) whose
 * execution path needs the `runtimed` daemon over a Unix socket, bridged by a
 * Vite dev-server relay plugin. Embedding it as a React dependency would mean
 * replicating that relay plus its module-global CRDT stores, so we host the
 * real dev server and frame it instead.
 */
const NTERACT_ORIGIN = import.meta.env["VITE_NTERACT_ORIGIN"] ?? "http://localhost:8737";
const DEFAULT_NOTEBOOK_PATH = "/tmp/ad-nb-python.ipynb";

function buildSrc(notebookPath: string): string {
	const url = new URL(NTERACT_ORIGIN);
	url.searchParams.set("path", notebookPath);
	return url.toString();
}

export function NotebookView() {
	const [notebookPath] = useState(DEFAULT_NOTEBOOK_PATH);
	const [reloadKey, setReloadKey] = useState(0);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-qa-id="notebook-view">
			<div className="border-border flex items-center gap-3 border-b px-4 py-2">
				<div className="min-w-0 flex-1">
					<h1 className="text-sm font-medium">Notebook</h1>
					<p className="text-muted-foreground truncate text-xs">{notebookPath}</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setReloadKey((key) => key + 1)}
					data-qa-id="notebook-reload"
				>
					Reload
				</Button>
			</div>
			<iframe
				key={reloadKey}
				src={buildSrc(notebookPath)}
				title="nteract notebook"
				className="min-h-0 flex-1 border-0"
				allow="clipboard-read; clipboard-write; fullscreen"
				data-qa-id="notebook-frame"
			/>
		</div>
	);
}

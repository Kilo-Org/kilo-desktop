import { loadTableFile, setWasmUrl, SiftTable, type SiftSource } from "@nteract/sift";
import siftWasmUrl from "@nteract/sift/sift.wasm?url";
import csvWasmUrl from "@nteract/sift-csv/wasm?url";
import { useEffect, useEffectEvent } from "react";

import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import type { SiftRuntime, SiftTableSource, SiftTableViewProps } from "./sift-runtime.js";
import { TABLE_LOAD_LIMITS } from "./table-limits.js";

// Sift's stylesheet is keyed on `.sift-root` and writes nothing to the
// document root; sift-host.css supplies the one token Kilo has to set.
import "@nteract/sift/style.css";
import "./sift-host.css";

// Both WASM binaries go through Vite's asset pipeline so the packaged app
// serves them from its own origin.
setWasmUrl(siftWasmUrl);

// CSV parsing is its own package and WASM module; load it with the first
// delimited file instead of with every table.
const csvModule = () =>
	import("@nteract/sift-csv").then((csv) => {
		csv.setWasmUrl(csvWasmUrl);
		return csv;
	});

async function loadSource(source: SiftTableSource) {
	if (source.kind === "csv") {
		const { csvToArrowIpc } = await csvModule();
		const ipc = await csvToArrowIpc(source.text, {
			delimiter: source.delimiter,
			maxRows: TABLE_LOAD_LIMITS.maxRows,
			maxColumns: TABLE_LOAD_LIMITS.maxColumns,
			maxOutputBytes: TABLE_LOAD_LIMITS.maxDecodedBytes,
		});
		return loadTableFile(ipc, { format: "arrow-ipc", ...TABLE_LOAD_LIMITS });
	}
	return loadTableFile(source.bytes, { format: source.format, ...TABLE_LOAD_LIMITS });
}

// wasm-bindgen rejects with the Rust error string itself, not an Error.
function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return "The table could not be loaded.";
}

/**
 * Adapts Files' in-memory sources to Sift's `loader` source. The loader is
 * memoized per source so Sift's effect (and StrictMode replays) get a fresh,
 * independently disposable table each run; Sift owns cancellation, store
 * disposal, and ignoring superseded results. Sift does not report loader
 * failures to hosts, so the loader reports them itself — gated on the source
 * still being current, because a superseded source's rejection can land after
 * its replacement and must not mark the new source failed.
 */
function SiftTableView({ source, ariaLabel, onLoadStateChange, onError }: SiftTableViewProps) {
	const callbacks = useLatestRef({ onLoadStateChange, onError });
	const currentSource = useLatestRef(source);

	const siftSource: SiftSource = {
		kind: "loader",
		load: () =>
			loadSource(source).catch((error: unknown) => {
				if (currentSource.current === source) callbacks.current.onError(errorMessage(error));
				throw error;
			}),
	};

	// Each new source starts a fresh load.
	const reportLoading = useEffectEvent((_source: SiftTableSource) => {
		callbacks.current.onLoadStateChange("loading");
	});
	useEffect(() => {
		reportLoading(source);
	}, [source]);

	return (
		<div aria-label={ariaLabel} className="flex min-h-0 min-w-0 flex-1" role="group">
			{/* The flex child needs min-w-0 or it widens to the table's full
			    column span and the viewport never overflows horizontally. */}
			<SiftTable
				className="min-h-0 min-w-0 flex-1"
				onLoadMilestone={(milestone) => {
					if (milestone.phase === "complete") callbacks.current.onLoadStateChange("complete");
				}}
				source={siftSource}
			/>
		</div>
	);
}

export const siftRuntime: SiftRuntime = { TableView: SiftTableView };

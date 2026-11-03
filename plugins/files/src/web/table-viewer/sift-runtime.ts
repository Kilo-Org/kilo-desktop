import type { ComponentType } from "react";

import type { BinaryTableFormat } from "../../contracts/models.js";
import type { CsvDelimiter } from "./table-format.js";

/**
 * In-memory sources only. The app CSP has no `blob:` in `connect-src`, so the
 * viewer never hands Sift a URL to fetch; bytes arrive over the authorized
 * Files IPC read and text comes from the live editor draft.
 */
export type SiftTableSource =
	| { readonly kind: "csv"; readonly text: string; readonly delimiter: CsvDelimiter }
	| { readonly kind: "bytes"; readonly format: BinaryTableFormat; readonly bytes: Uint8Array };

/** Sift loads all-or-error: rows only mount once the whole source decoded. */
export type SiftLoadState = "loading" | "complete";

export interface SiftTableViewProps {
	readonly source: SiftTableSource;
	readonly ariaLabel: string;
	readonly onLoadStateChange: (state: SiftLoadState) => void;
	readonly onError: (message: string) => void;
}

export interface SiftRuntime {
	readonly TableView: ComponentType<SiftTableViewProps>;
}

export type SiftRuntimeLoader = () => Promise<SiftRuntime>;

// A separate chunk keeps Sift, its WASM, and its stylesheet out of the Files
// entry until a table is actually opened.
const siftLoader: SiftRuntimeLoader = () =>
	import("./sift-adapter.js").then(({ siftRuntime }) => siftRuntime);

let loader: SiftRuntimeLoader = siftLoader;
let pending: Promise<SiftRuntime> | null = null;

export function loadSiftRuntime(): Promise<SiftRuntime> {
	pending ??= loader().catch((error: unknown) => {
		pending = null; // a failed load (e.g. chunk fetch) may succeed on reopen
		throw error;
	});
	return pending;
}

/** Test seam; `null` restores the real Sift adapter. */
export function configureSiftRuntime(next: SiftRuntimeLoader | null): void {
	loader = next ?? siftLoader;
	pending = null;
}

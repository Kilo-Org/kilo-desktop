import { useState } from "react";
import useDebounce from "react-use/esm/useDebounce.js";

import { useWorkspaceFileChanges } from "../file-changes.js";

export const RELOAD_DEBOUNCE_MS = 300;

/**
 * Reloads the open document when kilo.work-sessions' watcher reports it changed on
 * disk, vscode-style. All filtering lives in the watcher subscription: the
 * `files` option is the document's absolute path and only create/update changes
 * pass, so the callback fires exactly for disk changes to this file (watcher
 * paths are absolute and root-normalized, so the glob needs no root prefix,
 * and delete-only batches never reach it — deletes keep the stale content on
 * screen, as vscode does for untouchable panes). Matching changes bump a
 * monotonic counter — the `useDebounce` dependency — which arms a trailing
 * 300 ms timer to absorb write storms from agentic tools; react-use cancels
 * the timer automatically on unmount. The counter is never reset: a reset
 * would re-arm the timer into a guarded no-op fire and double renders per
 * cycle. useDebounce fires once on mount with the initial deps, hence the
 * zero-count guard; its internal callback ref means a fire always reads the
 * latest committed render, so a fire after a document switch simply targets
 * the new document (whose refresh no-ops until it is loaded).
 */
export function useDocumentWatcher(path: string | null, refresh: () => Promise<void>): void {
	const [changeCount, bumpChangeCount] = useState(0);

	useDebounce(
		() => {
			if (changeCount === 0) return; // useDebounce fires once on mount
			void refresh();
		},
		RELOAD_DEBOUNCE_MS,
		[changeCount],
	);

	useWorkspaceFileChanges({
		files: path === null ? undefined : [path],
		types: ["create", "update"],
		enabled: path !== null,
		onFileChange: () => bumpChangeCount((count) => count + 1),
	});
}

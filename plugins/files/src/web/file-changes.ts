import { useEffect, useMemo } from "react";
import useLatest from "react-use/esm/useLatest.js";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import {
	createWorkspaceChangeFilter,
	escapeGlob,
	FileWatcher,
	toPosixPath,
	type FileChange,
} from "@kilo-desktop/plugin-work-sessions/contracts";

const TRAILING_SLASHES = /\/+$/u;

export interface FileChangeOptions {
	/** Native directories, watched recursively. */
	readonly dirs?: readonly string[] | undefined;
	/** Native absolute file paths. */
	readonly files?: readonly string[] | undefined;
	readonly types?: readonly FileChange["type"][] | undefined;
	readonly enabled?: boolean | undefined;
	readonly onFileChange: () => void;
}

/**
 * Calls `onFileChange` for each batch of kilo.work-sessions' file changes with
 * a change under `dirs` or to one of `files` (of `types`, when given). The
 * window already receives every batch from kilo.work-sessions' watcher, so
 * this only filters them.
 */
export function useWorkspaceFileChanges(options: FileChangeOptions): void {
	const files = useDomainObject(FileWatcher);
	const onFileChange = useLatest(options.onFileChange);
	const includes = [
		...(options.dirs ?? []).map(
			(dir) => `${escapeGlob(toPosixPath(dir).replace(TRAILING_SLASHES, ""))}/**`,
		),
		...(options.files ?? []).map((file) => escapeGlob(toPosixPath(file))),
	];
	const filterKey = JSON.stringify([includes, options.types ?? null]);
	const filter = useMemo(() => {
		const [include, types] = JSON.parse(filterKey) as [string[], FileChange["type"][] | null];
		return createWorkspaceChangeFilter({ includes: include, ...(types ? { types } : {}) });
	}, [filterKey]);
	const watching = (options.enabled ?? true) && includes.length > 0;

	useEffect(() => {
		if (!files || !watching) return;
		return files.on("changed", (event) => {
			if (filter(event.changes).length > 0) onFileChange.current();
		});
	}, [files, filter, onFileChange, watching]);
}

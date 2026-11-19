import { useEffect } from "react";
import useLatest from "react-use/esm/useLatest.js";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import {
	createWorkspaceChangeFilter,
	escapeGlob,
	FileWatcher,
	toPosixPath,
	type FileChange,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { useStableValue } from "@kilo-desktop/ui/hooks/use-stable";

const TRAILING_SLASHES = /\/+$/u;

const sameContent = (previous: unknown, next: unknown): boolean =>
	JSON.stringify(previous) === JSON.stringify(next);

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
	const spec = useStableValue({ includes, types: options.types }, sameContent);
	const filter = createWorkspaceChangeFilter({
		includes: spec.includes,
		...(spec.types ? { types: [...spec.types] } : {}),
	});
	const watching = (options.enabled ?? true) && includes.length > 0;

	// The domain object's `on` returns its unsubscribe, which the effect returns.
	// react-doctor-disable-next-line react-doctor/effect-needs-cleanup
	useEffect(() => {
		if (!files || !watching) return;
		return files.on("changed", (event) => {
			if (filter(event.changes).length > 0) onFileChange.current();
		});
	}, [files, filter, onFileChange, watching]);
}

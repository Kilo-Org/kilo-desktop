import { useCallback, useEffect, useState } from "react";

import { useContextKey, useDomainObject } from "@kilo-desktop/kernel/web";
import { WorkSessions, type IsolationOptions, type WorkSessionIsolation } from "../../../contracts";
import { HAS_VCS_KEY } from "../../../contracts";

import { isUnborn } from "./IsolationControl";
import {
	readIsolationMode,
	rememberIsolationMode,
	type IsolationMode,
} from "./isolation-preference";

export interface LauncherIsolation {
	/** Null while there is nothing to choose: no version control, repository or workspace. */
	readonly options: IsolationOptions | null;
	readonly value: WorkSessionIsolation | null;
	readonly change: (value: WorkSessionIsolation, remember?: IsolationMode) => void;
	readonly reload: () => void;
}

function seeded(options: IsolationOptions, mode: IsolationMode): WorkSessionIsolation {
	if (mode === "local" || isUnborn(options)) return { kind: "local" };
	return options.defaultBranch
		? { kind: "new-copy", baseBranch: options.defaultBranch }
		: { kind: "new-copy" };
}

/**
 * The launcher's isolation choice for the active workspace: read from
 * `WorkSessions.isolationOptions` while a `vcs` contribution is
 * present, re-read when the window regains focus or the menu opens. Picks
 * last as long as the launcher is open; a workspace starts from its
 * remembered mode.
 */
export function useLauncherIsolation(workspaceId: string | null): LauncherIsolation {
	const sessions = useDomainObject(WorkSessions);
	const vcs = useContextKey(HAS_VCS_KEY);
	const [loaded, setLoaded] = useState<{ workspaceId: string; options: IsolationOptions | null }>();
	const [picked, setPicked] = useState<Record<string, WorkSessionIsolation>>({});
	const [generation, setGeneration] = useState(0);
	const reload = useCallback(() => setGeneration((value) => value + 1), []);

	useEffect(() => {
		if (!sessions || !vcs || !workspaceId) return;
		let current = true;
		sessions.methods
			.isolationOptions({ workspaceId })
			.catch(() => null)
			.then((options) => {
				if (current) setLoaded({ workspaceId, options });
			});
		return () => {
			current = false;
		};
	}, [sessions, vcs, workspaceId, generation]);

	useEffect(() => {
		globalThis.addEventListener("focus", reload);
		return () => globalThis.removeEventListener("focus", reload);
	}, [reload]);

	const options = vcs && workspaceId && loaded?.workspaceId === workspaceId ? loaded.options : null;
	const value =
		options && workspaceId
			? (picked[workspaceId] ?? seeded(options, readIsolationMode(workspaceId)))
			: null;
	const change = useCallback(
		(next: WorkSessionIsolation, remember?: IsolationMode) => {
			if (!workspaceId) return;
			setPicked((current) => ({ ...current, [workspaceId]: next }));
			if (remember) rememberIsolationMode(workspaceId, remember);
		},
		[workspaceId],
	);
	return { options, value, change, reload };
}

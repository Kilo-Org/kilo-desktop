import { useCallback, useEffect, useState } from "react";

import { useContextKey, useDomain } from "@kilo-desktop/kernel/web";
import {
	Sessions,
	type IsolationOptions,
	type SessionIsolation,
} from "@kilo-desktop/plugin-sessions/contracts";
import { VCS_KEY } from "@kilo-desktop/plugin-workspaces/contracts";

import { isUnborn } from "./IsolationControl";
import {
	readIsolationMode,
	rememberIsolationMode,
	type IsolationMode,
} from "./isolation-preference";

export interface LauncherIsolation {
	/** Null while there is nothing to choose: no version control, repository or workspace. */
	readonly options: IsolationOptions | null;
	readonly value: SessionIsolation | null;
	readonly change: (value: SessionIsolation, remember?: IsolationMode) => void;
	readonly reload: () => void;
}

function seeded(options: IsolationOptions, mode: IsolationMode): SessionIsolation {
	if (mode === "local" || isUnborn(options)) return { kind: "local" };
	return options.defaultBranch
		? { kind: "new-worktree", baseBranch: options.defaultBranch }
		: { kind: "new-worktree" };
}

/**
 * The launcher's isolation choice for the active workspace: read from
 * kilo.sessions' `isolationOptions` while a version control provider is
 * present, re-read when the window regains focus or the menu opens. Picks
 * last as long as the launcher is open; a workspace starts from its
 * remembered mode.
 */
export function useLauncherIsolation(workspaceId: string | null): LauncherIsolation {
	const sessions = useDomain(Sessions);
	const vcs = useContextKey(VCS_KEY);
	const [loaded, setLoaded] = useState<{ workspaceId: string; options: IsolationOptions | null }>();
	const [picked, setPicked] = useState<Record<string, SessionIsolation>>({});
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
		(next: SessionIsolation, remember?: IsolationMode) => {
			if (!workspaceId) return;
			setPicked((current) => ({ ...current, [workspaceId]: next }));
			if (remember) rememberIsolationMode(workspaceId, remember);
		},
		[workspaceId],
	);
	return { options, value, change, reload };
}

import { useEffect, useEffectEvent, useRef, useState } from "react";

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
	/** The isolation to start with, waiting for the active workspace's options if they're still loading. */
	readonly resolve: () => Promise<WorkSessionIsolation | null>;
	/**
	 * What the row shows: the active workspace's choice, or, while the next
	 * workspace's options load, the previous one's (`pending`), so the row
	 * holds its place instead of collapsing and reflowing.
	 */
	readonly shown: {
		readonly workspaceId: string;
		readonly options: IsolationOptions;
		readonly value: WorkSessionIsolation;
		readonly pending: boolean;
	} | null;
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
	const loading = useRef<{ workspaceId: string; options: Promise<IsolationOptions | null> }>(null);

	// Only the latest request may land, so a reload or workspace switch drops
	// any answer still in flight.
	const load = (methods: NonNullable<typeof sessions>["methods"], id: string) => {
		const request = methods.isolationOptions({ workspaceId: id }).catch(() => null);
		const entry = { workspaceId: id, options: request };
		loading.current = entry;
		void request.then((options) => {
			if (loading.current === entry) setLoaded({ workspaceId: id, options });
		});
	};
	const reload = () => {
		if (sessions && vcs && workspaceId) load(sessions.methods, workspaceId);
	};
	const loadSelected = useEffectEvent(load);

	useEffect(() => {
		if (!sessions || !vcs || !workspaceId) return;
		loadSelected(sessions.methods, workspaceId);
		return () => {
			loading.current = null;
		};
	}, [sessions, vcs, workspaceId]);

	useEffect(() => {
		globalThis.addEventListener("focus", reload);
		return () => globalThis.removeEventListener("focus", reload);
	}, [reload]);

	const valueFor = (id: string, from: IsolationOptions) =>
		picked[id] ?? seeded(from, readIsolationMode(id));
	const options = vcs && workspaceId && loaded?.workspaceId === workspaceId ? loaded.options : null;
	const value = options && workspaceId ? valueFor(workspaceId, options) : null;
	const shown =
		vcs && workspaceId && loaded?.options
			? {
					workspaceId: loaded.workspaceId,
					options: loaded.options,
					value: valueFor(loaded.workspaceId, loaded.options),
					pending: loaded.workspaceId !== workspaceId,
				}
			: null;
	const change = (next: WorkSessionIsolation, remember?: IsolationMode) => {
		if (!workspaceId) return;
		setPicked((current) => ({ ...current, [workspaceId]: next }));
		if (remember) rememberIsolationMode(workspaceId, remember);
	};
	// A start right after switching workspace must not go out without the new workspace's isolation.
	const resolve = async (): Promise<WorkSessionIsolation | null> => {
		if (!vcs || !workspaceId || loaded?.workspaceId === workspaceId) return value;
		const pending =
			loading.current?.workspaceId === workspaceId
				? loading.current.options
				: (sessions?.methods.isolationOptions({ workspaceId }).catch(() => null) ?? null);
		const fetched = await pending;
		return fetched ? valueFor(workspaceId, fetched) : null;
	};
	return { options, value, change, reload, resolve, shown };
}

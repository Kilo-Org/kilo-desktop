import type { AnyDomainObject, DomainObjectHandle, PluginSdk } from "@kilo-desktop/kernel";
import {
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type WorkSession,
	type WorkSessionFacetSource,
	type WorkSessionPullRequestState,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { PullRequests } from "../../contracts";
import { workSessionDirectory } from "./select";

interface Watched<TDomain extends AnyDomainObject> {
	current(): DomainObjectHandle<TDomain> | null;
}

/** Follows a domain object's handle and state for the plugin's lifetime, calling `onChange` on either. */
function watch<TDomain extends AnyDomainObject>(
	sdk: PluginSdk,
	domainObject: TDomain,
	onChange: () => void,
): Watched<TDomain> {
	let handle: DomainObjectHandle<TDomain> | null = null;
	let stop: (() => void) | undefined;
	sdk.onDispose(
		sdk.domainObjects.track(domainObject, {
			added: (added) => {
				handle = added;
				stop = added.subscribe(onChange);
				onChange();
			},
			removed: () => {
				stop?.();
				handle = null;
				onChange();
			},
		}),
	);
	sdk.onDispose(() => stop?.());
	return { current: () => handle };
}

interface Sources {
	pullRequests: Watched<typeof PullRequests>;
	workSessions: Watched<typeof WorkSessions>;
	workspaces: Watched<typeof Workspaces>;
}

const NO_WORK_SESSIONS: readonly WorkSession[] = [];
const NO_WORKSPACES: readonly Workspace[] = [];

/**
 * The `pull-request` work session facet: each work session's pull request
 * state from `kilo.git/pull-requests`, for the session list's filter. Like
 * origin's projection it skips the header's "branch awaiting lookup" rule, so
 * right after a branch switch the filter can lag the row badge until the
 * lookup lands. Listeners hear only real changes.
 */
export function createPullRequestFacet(
	sdk: PluginSdk,
): WorkSessionFacetSource<WorkSessionPullRequestState> {
	const listeners = new Set<() => void>();
	let value: Readonly<Record<string, WorkSessionPullRequestState>> = {};
	// Filled in after every domain object is watched: watching calls `update` at once.
	const sources: Partial<Sources> = {};

	const update = () => {
		const byDirectory = sources.pullRequests?.current()?.getState().byDirectory ?? {};
		const folders = sources.workspaces?.current()?.getState().workspaces ?? NO_WORKSPACES;
		const next: Record<string, WorkSessionPullRequestState> = {};
		const workSessions =
			sources.workSessions?.current()?.getState().workSessions ?? NO_WORK_SESSIONS;
		for (const workSession of workSessions) {
			const directory = workSessionDirectory(workSession, folders);
			const state = directory ? byDirectory[directory]?.snapshot.pullRequest?.state : undefined;
			if (state) next[workSession.id] = state;
		}
		const keys = Object.keys(next);
		if (keys.length === Object.keys(value).length && keys.every((id) => value[id] === next[id])) {
			return;
		}
		value = next;
		for (const listener of listeners) listener();
	};
	sources.pullRequests = watch(sdk, PullRequests, update);
	sources.workSessions = watch(sdk, WorkSessions, update);
	sources.workspaces = watch(sdk, Workspaces, update);
	update();

	return {
		get: () => value,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/**
 * Tells `kilo.git/pull-requests` which directory this window shows (its open
 * work session's) and whether it is visible, whenever either changes, so the
 * open work session's pull request is polled on the short interval.
 */
export function reportShownDirectories(sdk: PluginSdk, windowId: string): void {
	let reported: string | null = null;
	const sources: Partial<Sources & { window: Watched<typeof WorkSessionsWindow> }> = {};
	const report = () => {
		const pullRequestsHandle = sources.pullRequests?.current();
		if (!pullRequestsHandle) {
			reported = null;
			return;
		}
		const activeId = sources.window?.current()?.getState().activeWorkSessionId;
		const workSession = sources.workSessions
			?.current()
			?.getState()
			.workSessions.find(({ id }) => id === activeId);
		const folders = sources.workspaces?.current()?.getState().workspaces ?? NO_WORKSPACES;
		const directory = workSession ? workSessionDirectory(workSession, folders) : null;
		const input = {
			windowId,
			directories: directory ? [directory] : [],
			visible: globalThis.document?.visibilityState !== "hidden",
		};
		const key = JSON.stringify(input);
		if (key === reported) return;
		reported = key;
		void pullRequestsHandle.methods.setActive(input).catch(() => {
			if (reported === key) reported = null;
		});
	};
	sources.window = watch(sdk, WorkSessionsWindow, report);
	sources.workSessions = watch(sdk, WorkSessions, report);
	sources.workspaces = watch(sdk, Workspaces, report);
	sources.pullRequests = watch(sdk, PullRequests, report);
	report();
	globalThis.document?.addEventListener("visibilitychange", report);
	sdk.onDispose(() => globalThis.document?.removeEventListener("visibilitychange", report));
}

import type { AnyDomain, DomainHandle, PluginSdk } from "@kilo-desktop/kernel";
import { WorkSessions, type WorkSession } from "@kilo-desktop/plugin-sessions/contracts";
import {
	Workbench,
	type SessionFacetSource,
	type SessionPullRequestState,
} from "@kilo-desktop/plugin-workbench/contracts";
import { Workspaces, type Workspace } from "@kilo-desktop/plugin-workspaces/contracts";

import { PullRequests } from "../../contracts/index.js";
import { sessionDirectory } from "./select.js";

interface Watched<TDomain extends AnyDomain> {
	current(): DomainHandle<TDomain> | null;
}

/** Follows a domain's handle and state for the plugin's lifetime, calling `onChange` on either. */
function watch<TDomain extends AnyDomain>(
	sdk: PluginSdk,
	domain: TDomain,
	onChange: () => void,
): Watched<TDomain> {
	let handle: DomainHandle<TDomain> | null = null;
	let stop: (() => void) | undefined;
	sdk.onDispose(
		sdk.domains.track(domain, {
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
	sessions: Watched<typeof WorkSessions>;
	workspaces: Watched<typeof Workspaces>;
}

const NO_SESSIONS: readonly WorkSession[] = [];
const NO_WORKSPACES: readonly Workspace[] = [];

/**
 * The `pull-request` session facet: each session's pull request state from
 * `kilo.git/pull-requests`, for the session list's filter. Like origin's
 * projection it skips the header's "branch awaiting lookup" rule, so right
 * after a branch switch the filter can lag the row badge until the lookup
 * lands. Listeners hear only real changes.
 */
export function createPullRequestFacet(
	sdk: PluginSdk,
): SessionFacetSource<SessionPullRequestState> {
	const listeners = new Set<() => void>();
	let value: Readonly<Record<string, SessionPullRequestState>> = {};
	// Filled in after every domain is watched: watching calls `update` at once.
	const sources: Partial<Sources> = {};

	const update = () => {
		const byDirectory = sources.pullRequests?.current()?.getState().byDirectory ?? {};
		const folders = sources.workspaces?.current()?.getState().workspaces ?? NO_WORKSPACES;
		const next: Record<string, SessionPullRequestState> = {};
		for (const session of sources.sessions?.current()?.getState().sessions ?? NO_SESSIONS) {
			const directory = sessionDirectory(session, folders);
			const state = directory ? byDirectory[directory]?.snapshot.pullRequest?.state : undefined;
			if (state) next[session.id] = state;
		}
		const keys = Object.keys(next);
		if (keys.length === Object.keys(value).length && keys.every((id) => value[id] === next[id])) {
			return;
		}
		value = next;
		for (const listener of listeners) listener();
	};
	sources.pullRequests = watch(sdk, PullRequests, update);
	sources.sessions = watch(sdk, WorkSessions, update);
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
 * session's) and whether it is visible, whenever either changes, so the open
 * session's pull request is polled on the short interval.
 */
export function reportShownDirectories(sdk: PluginSdk, windowId: string): void {
	let reported: string | null = null;
	const sources: Partial<Sources & { navigator: Watched<typeof Workbench> }> = {};
	const report = () => {
		const pullRequestsHandle = sources.pullRequests?.current();
		if (!pullRequestsHandle) {
			reported = null;
			return;
		}
		const activeId = sources.navigator?.current()?.getState().activeSessionId;
		const session = sources.sessions
			?.current()
			?.getState()
			.sessions.find(({ id }) => id === activeId);
		const folders = sources.workspaces?.current()?.getState().workspaces ?? NO_WORKSPACES;
		const directory = session ? sessionDirectory(session, folders) : null;
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
	sources.navigator = watch(sdk, Workbench, report);
	sources.sessions = watch(sdk, WorkSessions, report);
	sources.workspaces = watch(sdk, Workspaces, report);
	sources.pullRequests = watch(sdk, PullRequests, report);
	report();
	globalThis.document?.addEventListener("visibilitychange", report);
	sdk.onDispose(() => globalThis.document?.removeEventListener("visibilitychange", report));
}

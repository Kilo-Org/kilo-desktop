import { KernelError, type DomainHandle, type PluginSdk } from "@kilo-desktop/kernel";
import { Panes } from "@kilo-desktop/plugin-sessions/contracts";

import {
	CHAT_PLUGIN_ID,
	MEDIA_PANE_KIND,
	mediaItemLength,
	MediaViewers,
	mediaViewerKey,
	type MediaItem,
} from "../contracts";

/** How long a viewer's items wait for their pane before they're dropped. */
export const PENDING_PANE_GRACE_MS = 60_000;

/** The most main holds across all viewers, in characters (~100 MB of strings). */
export const MEDIA_VIEWERS_MAX_TOTAL_LENGTH = 96 * 1024 * 1024;

const viewerLength = (items: readonly MediaItem[]): number =>
	items.reduce((total, item) => total + mediaItemLength(item), 0);

function assertChat(caller: { pluginId: string }): void {
	if (caller.pluginId !== CHAT_PLUGIN_ID) {
		throw new KernelError("PERMISSION_DENIED", "Only kilo.chat shows media.");
	}
}

/**
 * The `media-viewers` domain object: the items each media viewer pane shows,
 * kept in memory only (see `MediaViewers`).
 *
 * Items live in a map here, not in the domain state: the state only carries
 * a revision per viewer, so a change broadcasts and validates a few numbers
 * rather than every viewer's images. The map is kept in use order (showing or
 * fetching a viewer moves it to the end), and once it holds more than
 * `MEDIA_VIEWERS_MAX_TOTAL_LENGTH` the viewers used longest ago are dropped,
 * open panes or not: there's one viewer per chat, so many open chats would
 * otherwise hold many viewers' images at once.
 *
 * A viewer's items go when its pane closes. Panes are saved and restored but
 * the items are not, so viewer panes restored at launch would be empty: they
 * are closed once kilo.sessions' panes arrive, before any window opens one.
 * Panes that disappear without a `closed` event (their session was deleted)
 * are pruned whenever the panes change. A window sets a viewer's items just
 * before opening its pane, so a viewer whose pane hasn't appeared yet is
 * pending: spared by pruning, but dropped if its pane doesn't appear within
 * `PENDING_PANE_GRACE_MS` (the open failed, or its window went away).
 */
export function provideMediaViewers(sdk: PluginSdk): void {
	const itemsByKey = new Map<string, readonly MediaItem[]>();
	const pending = new Map<string, ReturnType<typeof setTimeout>>();
	let panes: DomainHandle<typeof Panes> | null = null;
	let revision = 0;

	const liveKeys = (): Set<string> => {
		const live = new Set<string>();
		for (const [sessionId, session] of Object.entries(panes?.getState().bySession ?? {})) {
			for (const pane of session.panes) live.add(mediaViewerKey(sessionId, pane.id));
		}
		return live;
	};

	const settlePending = (key: string) => {
		const timer = pending.get(key);
		if (timer === undefined) return;
		clearTimeout(timer);
		pending.delete(key);
	};

	const drop = (keys: readonly string[]) => {
		const viewers = { ...provider.state.viewers };
		let changed = false;
		for (const key of keys) {
			settlePending(key);
			itemsByKey.delete(key);
			if (!(key in viewers)) continue;
			delete viewers[key];
			changed = true;
		}
		if (changed) provider.setState({ viewers });
	};

	const awaitPane = (key: string) => {
		settlePending(key);
		const timer = setTimeout(() => {
			pending.delete(key);
			if (!liveKeys().has(key)) drop([key]);
		}, PENDING_PANE_GRACE_MS);
		(timer as { unref?: () => void }).unref?.();
		pending.set(key, timer);
	};

	/** Moves a viewer to the end of the use order. */
	const touch = (key: string, items: readonly MediaItem[]) => {
		itemsByKey.delete(key);
		itemsByKey.set(key, items);
	};

	/** Drops the viewers used longest ago until the rest fit, never `keep`. */
	const evictBeyondCap = (keep: string) => {
		let total = viewerLength([...itemsByKey.values()].flat());
		const evicted: string[] = [];
		for (const [key, items] of itemsByKey) {
			if (total <= MEDIA_VIEWERS_MAX_TOTAL_LENGTH) break;
			if (key === keep) continue;
			total -= viewerLength(items);
			evicted.push(key);
		}
		drop(evicted);
	};

	const provider = sdk.domains.provide(MediaViewers, {
		initialState: { viewers: {} },
		methods: {
			show: ({ sessionId, paneId, items }, caller) => {
				assertChat(caller);
				const key = mediaViewerKey(sessionId, paneId);
				touch(key, items);
				revision += 1;
				provider.setState({ viewers: { ...provider.state.viewers, [key]: { revision } } });
				evictBeyondCap(key);
				if (!liveKeys().has(key)) awaitPane(key);
				return { revision };
			},
			items: ({ sessionId, paneId }, caller) => {
				assertChat(caller);
				const key = mediaViewerKey(sessionId, paneId);
				const items = itemsByKey.get(key);
				if (!items) return null;
				touch(key, items);
				return [...items];
			},
			discard: ({ sessionId, paneId }, caller) => {
				assertChat(caller);
				const key = mediaViewerKey(sessionId, paneId);
				// An open pane keeps showing its items; they go when it closes.
				if (!liveKeys().has(key)) drop([key]);
			},
		},
	});

	const closeRestored = (handle: DomainHandle<typeof Panes>) => {
		for (const [sessionId, session] of Object.entries(handle.getState().bySession)) {
			for (const pane of session.panes) {
				if (pane.kind !== MEDIA_PANE_KIND) continue;
				if (itemsByKey.has(mediaViewerKey(sessionId, pane.id))) continue;
				void handle.methods.close({ sessionId, paneId: pane.id }).catch(() => undefined);
			}
		}
	};

	const prune = () => {
		const live = liveKeys();
		for (const key of live) settlePending(key);
		drop([...itemsByKey.keys()].filter((key) => !live.has(key) && !pending.has(key)));
	};

	let stops: (() => void)[] = [];
	sdk.domains.track(Panes, {
		added: (handle) => {
			panes = handle;
			closeRestored(handle);
			stops = [
				handle.on("closed", ({ sessionId, pane }) => drop([mediaViewerKey(sessionId, pane.id)])),
				handle.subscribe(prune),
			];
		},
		removed: () => {
			for (const stop of stops) stop();
			stops = [];
			panes = null;
		},
	});
}

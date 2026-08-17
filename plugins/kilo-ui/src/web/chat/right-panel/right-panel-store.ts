/** Per-session right-panel tab state (t3code-inspired). */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
	createContributedTab,
	createPlanTab,
	PLAN_TAB_DEFINITION_ID,
	type RightPanelTab,
	type RightPanelTabDefinition,
} from "./right-panel-tab-registry.js";

export type { RightPanelTab } from "./right-panel-tab-registry.js";

export const DRAFT_RIGHT_PANEL_SESSION_KEY = "draft";
export const RIGHT_PANEL_STORAGE_KEY = "kilo-ui:right-panel-state:v2";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const memoryStorage = (): StorageLike => {
	const data = new Map<string, string>();
	return {
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
		removeItem: (key) => {
			data.delete(key);
		},
	};
};

function resolveStorage(): StorageLike {
	try {
		if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
	} catch {
		// Ignore storage access errors (private mode / SSR).
	}
	return memoryStorage();
}

export interface SessionRightPanelState {
	isOpen: boolean;
	activeTabId: string | null;
	tabs: RightPanelTab[];
	/** Tool-call id of the plan snapshot shown in the plan tab; null = newest. */
	planAnchorCallId: string | null;
}

export type OpenPlanOptions = {
	/** When set, the plan tab shows this card's snapshot instead of the newest plan. */
	anchorCallId?: string;
};

interface RightPanelStoreState {
	bySessionId: Record<string, SessionRightPanelState>;
	moveSessionState: (sourceSessionId: string, targetSessionId: string) => void;
	openTab: (sessionId: string, definition: Pick<RightPanelTabDefinition, "id" | "title">) => void;
	openPlan: (sessionId: string, options?: OpenPlanOptions) => void;
	activateTab: (sessionId: string, tabId: string) => void;
	setTabDirty: (sessionId: string, tabId: string, dirty: boolean) => void;
	closeTab: (sessionId: string, tabId: string) => void;
	show: (sessionId: string) => void;
	close: (sessionId: string) => void;
	toggleVisibility: (sessionId: string) => void;
}

export function persistedRightPanelState(
	state: RightPanelStoreState,
): Pick<RightPanelStoreState, "bySessionId"> {
	return {
		bySessionId: Object.fromEntries(
			Object.entries(state.bySessionId).map(([sessionId, session]) => [
				sessionId,
				{
					...session,
					tabs: session.tabs.map(({ dirty: _dirty, ...tab }) => tab),
				},
			]),
		),
	};
}

export const EMPTY_SESSION_RIGHT_PANEL_STATE: SessionRightPanelState = {
	isOpen: false,
	activeTabId: null,
	tabs: [],
	planAnchorCallId: null,
};

const upsertTab = (
	current: SessionRightPanelState,
	tab: RightPanelTab,
	activate = true,
): SessionRightPanelState => ({
	...current,
	isOpen: true,
	tabs: current.tabs.some((entry) => entry.instanceId === tab.instanceId)
		? current.tabs
		: [...current.tabs, tab],
	activeTabId: activate ? tab.instanceId : current.activeTabId,
});

const updateSession = (
	bySessionId: Record<string, SessionRightPanelState>,
	sessionId: string,
	updater: (current: SessionRightPanelState) => SessionRightPanelState,
): Record<string, SessionRightPanelState> => {
	const current = bySessionId[sessionId] ?? EMPTY_SESSION_RIGHT_PANEL_STATE;
	const next = updater(current);
	if (!next.isOpen && next.activeTabId === null && next.tabs.length === 0) {
		if (!(sessionId in bySessionId)) return bySessionId;
		const { [sessionId]: _removed, ...rest } = bySessionId;
		return rest;
	}
	if (next === current) return bySessionId;
	return { ...bySessionId, [sessionId]: next };
};

export const useRightPanelStore = create<RightPanelStoreState>()(
	persist(
		(set) => ({
			bySessionId: {},
			moveSessionState: (sourceSessionId, targetSessionId) =>
				set((state) => {
					if (sourceSessionId === targetSessionId) return state;
					const source = state.bySessionId[sourceSessionId];
					if (!source) return state;
					const { [sourceSessionId]: _removed, ...remaining } = state.bySessionId;
					return {
						bySessionId: {
							...remaining,
							[targetSessionId]: remaining[targetSessionId] ?? source,
						},
					};
				}),
			openTab: (sessionId, definition) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						upsertTab(current, createContributedTab(current.tabs, definition)),
					),
				})),
			openPlan: (sessionId, options) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) => ({
						...upsertTab(current, createPlanTab()),
						planAnchorCallId: options?.anchorCallId?.trim() || null,
					})),
				})),
			activateTab: (sessionId, tabId) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						current.tabs.some((tab) => tab.instanceId === tabId)
							? { ...current, isOpen: true, activeTabId: tabId }
							: current,
					),
				})),
			setTabDirty: (sessionId, tabId, dirty) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) => {
						let changed = false;
						const tabs = current.tabs.map((tab) => {
							if (tab.instanceId !== tabId || tab.dirty === dirty) return tab;
							changed = true;
							return { ...tab, dirty };
						});
						return changed ? { ...current, tabs } : current;
					}),
				})),
			closeTab: (sessionId, tabId) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) => {
						const index = current.tabs.findIndex((tab) => tab.instanceId === tabId);
						if (index < 0) return current;
						const closing = current.tabs[index];
						const tabs = current.tabs.filter((tab) => tab.instanceId !== tabId);
						const planAnchorCallId =
							closing?.definitionId === PLAN_TAB_DEFINITION_ID
								? null
								: (current.planAnchorCallId ?? null);
						if (current.activeTabId !== tabId) {
							return { ...current, tabs, planAnchorCallId };
						}
						const fallback = tabs[Math.min(index, tabs.length - 1)] ?? null;
						return {
							...current,
							isOpen: true,
							tabs,
							activeTabId: fallback?.instanceId ?? null,
							planAnchorCallId,
						};
					}),
				})),
			show: (sessionId) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						current.isOpen ? current : { ...current, isOpen: true },
					),
				})),
			close: (sessionId) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						current.isOpen ? { ...current, isOpen: false } : current,
					),
				})),
			toggleVisibility: (sessionId) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) => ({
						...current,
						isOpen: !current.isOpen,
					})),
				})),
		}),
		{
			name: RIGHT_PANEL_STORAGE_KEY,
			version: 2,
			storage: createJSONStorage(resolveStorage),
			partialize: persistedRightPanelState,
		},
	),
);

export function selectSessionRightPanelState(
	bySessionId: Record<string, SessionRightPanelState>,
	sessionId: string | null | undefined,
): SessionRightPanelState {
	if (!sessionId) return EMPTY_SESSION_RIGHT_PANEL_STATE;
	return bySessionId[sessionId] ?? EMPTY_SESSION_RIGHT_PANEL_STATE;
}

export function selectActiveRightPanelTab(
	bySessionId: Record<string, SessionRightPanelState>,
	sessionId: string | null | undefined,
): RightPanelTab | null {
	const state = selectSessionRightPanelState(bySessionId, sessionId);
	if (!state.isOpen) return null;
	return state.tabs.find((tab) => tab.instanceId === state.activeTabId) ?? null;
}

export function resolveRightPanelSessionKey(
	remoteId: string | undefined,
	localId?: string | undefined,
): string {
	if (remoteId?.trim()) return remoteId;
	if (localId?.trim()) return localId;
	return DRAFT_RIGHT_PANEL_SESSION_KEY;
}

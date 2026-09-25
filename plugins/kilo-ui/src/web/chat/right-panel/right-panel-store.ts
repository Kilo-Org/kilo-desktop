/**
 * Owns per-session pane identity and geometry, including draft-to-session promotion.
 * Templates update tabs and layout atomically so reconciliation never sees orphaned
 * panes; existing tab identities and unsaved state survive layout changes. A draft
 * resolves its default once, even when none is configured, until explicitly cleared.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { ARRANGEMENTS, type Arrangement } from "@kilo-desktop/pane-layout";
import type { LayoutTemplate } from "../../../contracts/layout-presets/schemas.js";
import { applyLayoutTemplate } from "../layout-presets/layout-template.js";

import {
	createContributedTab,
	createPlanTab,
	PLAN_TAB_DEFINITION_ID,
	type CreateContributedTabOptions,
	type RightPanelTab,
	type RightPanelTabDefinition,
	type RightPanelTabUpdate,
} from "./right-panel-tab-registry.js";

export type { RightPanelTab } from "./right-panel-tab-registry.js";

export const DRAFT_RIGHT_PANEL_SESSION_KEY = "draft";
export const RIGHT_PANEL_STORAGE_KEY = "kilo-ui:right-panel-state:v3";
export const DEFAULT_ARRANGEMENT: Arrangement = "tiles";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PersistedSessionState = SessionRightPanelState & { readonly isOpen?: boolean };

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
		const ls = globalThis.localStorage;
		if (typeof ls?.setItem === "function") return ls;
	} catch {
		// Ignore storage access errors (private mode / SSR / Node without --localstorage-file).
	}
	return memoryStorage();
}

export interface SessionRightPanelState {
	activeTabId: string | null;
	tabs: RightPanelTab[];
	/** Tool-call id of the plan snapshot shown in the plan tab; null = newest. */
	planAnchorCallId: string | null;
	/** False when the Chat pane is hidden while artifact panes remain. */
	chatPaneOpen?: boolean;
	/** Tiles / Carousel. Invalid persisted values fall back to Tiles. */
	arrangement?: Arrangement;
	layoutJson?: string;
	/** A new draft resolves its default only once, including when no default is set. */
	defaultLayoutInitialized?: boolean;
}

export type OpenPlanOptions = {
	/** When set, the plan tab shows this card's snapshot instead of the newest plan. */
	anchorCallId?: string;
};

interface RightPanelStoreState {
	bySessionId: Record<string, SessionRightPanelState>;
	moveSessionState: (sourceSessionId: string, targetSessionId: string) => void;
	clearSession: (sessionId: string) => void;
	openTab: (
		sessionId: string,
		definition: Pick<RightPanelTabDefinition, "id" | "title">,
		options?: CreateContributedTabOptions,
	) => void;
	openPlan: (sessionId: string, options?: OpenPlanOptions) => void;
	activateTab: (sessionId: string, tabId: string) => void;
	updateTab: (sessionId: string, tabId: string, update: RightPanelTabUpdate) => void;
	closeTab: (sessionId: string, tabId: string) => void;
	setChatPaneOpen: (sessionId: string, open: boolean) => void;
	setLayout: (sessionId: string, layoutJson: string) => void;
	setArrangement: (sessionId: string, arrangement: Arrangement) => void;
	applyTemplate: (
		sessionId: string,
		template: LayoutTemplate,
		availableDefinitionIds: readonly string[],
	) => void;
	initializeDefaultLayout: (
		sessionId: string,
		template: LayoutTemplate | undefined,
		availableDefinitionIds: readonly string[],
	) => void;
}

export function persistedRightPanelState(
	state: RightPanelStoreState,
): Pick<RightPanelStoreState, "bySessionId"> {
	return {
		bySessionId: Object.fromEntries(
			Object.entries(state.bySessionId)
				.filter(([sessionId]) => sessionId !== DRAFT_RIGHT_PANEL_SESSION_KEY)
				.filter(
					([, session]) =>
						session.tabs.length > 0 ||
						session.layoutJson !== undefined ||
						session.chatPaneOpen !== undefined ||
						(session.arrangement ?? DEFAULT_ARRANGEMENT) !== DEFAULT_ARRANGEMENT,
				)
				.map(([sessionId, session]) => {
					const { isOpen: _legacyIsOpen, ...current } = session as PersistedSessionState;
					const tabs = session.tabs
						.filter((tab) => !tab.transient)
						.map(({ dirty: _dirty, transient: _transient, ...tab }) => tab);
					const activeTabId = tabs.some((tab) => tab.instanceId === session.activeTabId)
						? session.activeTabId
						: (tabs.at(-1)?.instanceId ?? null);
					return [sessionId, { ...current, tabs, activeTabId }];
				}),
		),
	};
}

export const EMPTY_SESSION_RIGHT_PANEL_STATE: SessionRightPanelState = {
	activeTabId: null,
	tabs: [],
	planAnchorCallId: null,
	arrangement: DEFAULT_ARRANGEMENT,
};

const upsertTab = (
	current: SessionRightPanelState,
	tab: RightPanelTab,
	activate = true,
	updates?: CreateContributedTabOptions,
): SessionRightPanelState => {
	const existing = current.tabs.find((entry) => entry.instanceId === tab.instanceId);
	const tabs = existing
		? current.tabs.map((entry) =>
				entry.instanceId === tab.instanceId
					? {
							...entry,
							...(updates?.title !== undefined ? { title: updates.title } : {}),
							...(updates?.iconKey !== undefined ? { iconKey: updates.iconKey } : {}),
							...(updates?.metadata !== undefined ? { metadata: { ...updates.metadata } } : {}),
							...(updates?.transient !== undefined ? { transient: updates.transient } : {}),
						}
					: entry,
			)
		: [...current.tabs, tab];
	return {
		...current,
		tabs,
		activeTabId: activate ? tab.instanceId : current.activeTabId,
	};
};

const updateSession = (
	bySessionId: Record<string, SessionRightPanelState>,
	sessionId: string,
	updater: (current: SessionRightPanelState) => SessionRightPanelState,
): Record<string, SessionRightPanelState> => {
	const current = bySessionId[sessionId] ?? EMPTY_SESSION_RIGHT_PANEL_STATE;
	const next = updater(current);
	if (
		next.activeTabId === null &&
		next.tabs.length === 0 &&
		!next.layoutJson &&
		!next.defaultLayoutInitialized &&
		(next.arrangement ?? DEFAULT_ARRANGEMENT) === DEFAULT_ARRANGEMENT
	) {
		if (!(sessionId in bySessionId)) return bySessionId;
		const { [sessionId]: _removed, ...rest } = bySessionId;
		return rest;
	}
	if (next === current) return bySessionId;
	return { ...bySessionId, [sessionId]: next };
};

function mergeSessionState(
	source: SessionRightPanelState,
	target: SessionRightPanelState,
): SessionRightPanelState {
	const tabs = [...target.tabs];
	for (const sourceTab of source.tabs) {
		const index = tabs.findIndex((tab) => tab.instanceId === sourceTab.instanceId);
		if (index < 0) {
			tabs.push(sourceTab);
			continue;
		}
		const targetTab = tabs[index]!;
		if (targetTab.definitionId === sourceTab.definitionId) {
			tabs[index] = { ...targetTab, ...sourceTab, ordinal: targetTab.ordinal };
		}
	}
	const tabIds = new Set(tabs.map((tab) => tab.instanceId));
	const activeTabId =
		target.activeTabId && tabIds.has(target.activeTabId)
			? target.activeTabId
			: source.activeTabId && tabIds.has(source.activeTabId)
				? source.activeTabId
				: null;
	const targetHasPlan = target.tabs.some((tab) => tab.definitionId === PLAN_TAB_DEFINITION_ID);
	const sourceHasSurvivingPlan =
		!targetHasPlan && tabs.some((tab) => tab.definitionId === PLAN_TAB_DEFINITION_ID);
	const preferredChatPaneOpen = target.chatPaneOpen ?? source.chatPaneOpen;
	const arrangement = ARRANGEMENTS.includes(target.arrangement as Arrangement)
		? (target.arrangement as Arrangement)
		: ARRANGEMENTS.includes(source.arrangement as Arrangement)
			? (source.arrangement as Arrangement)
			: DEFAULT_ARRANGEMENT;

	return {
		activeTabId,
		tabs,
		planAnchorCallId: targetHasPlan
			? target.planAnchorCallId
			: sourceHasSurvivingPlan
				? source.planAnchorCallId
				: null,
		...(tabs.length === 0
			? { chatPaneOpen: true }
			: preferredChatPaneOpen === undefined
				? {}
				: { chatPaneOpen: preferredChatPaneOpen }),
		arrangement,
		...(source.defaultLayoutInitialized || target.defaultLayoutInitialized
			? { defaultLayoutInitialized: true }
			: {}),
		...(target.layoutJson
			? { layoutJson: target.layoutJson }
			: source.layoutJson
				? { layoutJson: source.layoutJson }
				: {}),
	};
}

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
					const target = remaining[targetSessionId];
					return {
						bySessionId: {
							...remaining,
							[targetSessionId]: target ? mergeSessionState(source, target) : source,
						},
					};
				}),
			clearSession: (sessionId) =>
				set((state) => {
					if (!(sessionId in state.bySessionId)) return state;
					const { [sessionId]: _removed, ...remaining } = state.bySessionId;
					return { bySessionId: remaining };
				}),
			openTab: (sessionId, definition, options) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						upsertTab(
							current,
							createContributedTab(current.tabs, definition, undefined, options),
							options?.activate !== false,
							options,
						),
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
							? { ...current, activeTabId: tabId }
							: current,
					),
				})),
			updateTab: (sessionId, tabId, update) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) => {
						let changed = false;
						const tabs = current.tabs.map((tab) => {
							if (tab.instanceId !== tabId) return tab;
							const next = {
								...tab,
								...(update.title !== undefined ? { title: update.title } : {}),
								...(update.iconKey !== undefined ? { iconKey: update.iconKey } : {}),
								...(update.metadata !== undefined ? { metadata: { ...update.metadata } } : {}),
								...(update.dirty !== undefined ? { dirty: update.dirty } : {}),
								...(update.transient !== undefined ? { transient: update.transient } : {}),
							};
							if (
								next.title === tab.title &&
								next.iconKey === tab.iconKey &&
								next.metadata === tab.metadata &&
								next.dirty === tab.dirty &&
								next.transient === tab.transient
							) {
								return tab;
							}
							changed = true;
							return next;
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
						const chatPaneOpen =
							current.chatPaneOpen === false && tabs.length === 0 ? true : current.chatPaneOpen;
						const planAnchorCallId =
							closing?.definitionId === PLAN_TAB_DEFINITION_ID
								? null
								: (current.planAnchorCallId ?? null);
						if (current.activeTabId !== tabId) {
							return {
								...current,
								tabs,
								planAnchorCallId,
								...(chatPaneOpen === undefined ? {} : { chatPaneOpen }),
							};
						}
						const fallback = tabs[Math.min(index, tabs.length - 1)] ?? null;
						return {
							...current,
							tabs,
							activeTabId: fallback?.instanceId ?? null,
							planAnchorCallId,
							...(chatPaneOpen === undefined ? {} : { chatPaneOpen }),
						};
					}),
				})),
			setChatPaneOpen: (sessionId, open) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						(current.chatPaneOpen !== false) === open
							? current
							: { ...current, chatPaneOpen: open },
					),
				})),
			setLayout: (sessionId, layoutJson) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						current.layoutJson === layoutJson ? current : { ...current, layoutJson },
					),
				})),
			setArrangement: (sessionId, arrangement) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						current.arrangement === arrangement ? current : { ...current, arrangement },
					),
				})),
			applyTemplate: (sessionId, template, availableDefinitionIds) =>
				set((state) => ({
					bySessionId: updateSession(state.bySessionId, sessionId, (current) =>
						applyLayoutTemplate(template, sessionId, current, new Set(availableDefinitionIds)),
					),
				})),
			initializeDefaultLayout: (sessionId, template, availableDefinitionIds) =>
				set((state) => {
					if (state.bySessionId[sessionId]) return state;
					return {
						bySessionId: {
							...state.bySessionId,
							[sessionId]: {
								...(template
									? applyLayoutTemplate(
											template,
											sessionId,
											EMPTY_SESSION_RIGHT_PANEL_STATE,
											new Set(availableDefinitionIds),
										)
									: EMPTY_SESSION_RIGHT_PANEL_STATE),
								defaultLayoutInitialized: true,
							},
						},
					};
				}),
		}),
		{
			name: RIGHT_PANEL_STORAGE_KEY,
			version: 1,
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
	const session = bySessionId[sessionId];
	if (!session) return EMPTY_SESSION_RIGHT_PANEL_STATE;
	const arrangement =
		typeof session.arrangement === "string" &&
		(ARRANGEMENTS as readonly string[]).includes(session.arrangement)
			? session.arrangement
			: DEFAULT_ARRANGEMENT;
	return arrangement === session.arrangement ? session : { ...session, arrangement };
}

export function selectActiveRightPanelTab(
	bySessionId: Record<string, SessionRightPanelState>,
	sessionId: string | null | undefined,
): RightPanelTab | null {
	const state = selectSessionRightPanelState(bySessionId, sessionId);
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

/**
 * The session key the pane canvas should render right now. A remote session id
 * arrives one commit before `moveSessionState` carries the pre-promotion bucket
 * over; rendering the promoted key during that gap would unmount every open
 * pane (destroying terminal iframe documents mid-session), so keep rendering
 * the pre-promotion bucket until the promoted one exists.
 */
export function resolveVisibleRightPanelSessionKey(
	bySessionId: Record<string, SessionRightPanelState>,
	promotedKey: string,
	prePromotionKey: string,
): string {
	if (promotedKey === prePromotionKey) return promotedKey;
	if (bySessionId[promotedKey]) return promotedKey;
	return bySessionId[prePromotionKey] ? prePromotionKey : promotedKey;
}

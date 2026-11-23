import { useState } from "react";

import type { ModelPreferences } from "@kilo-desktop/plugin-core/contracts";

import {
	ChatSelections,
	SelectionRecords,
	useSelectionRecords,
	type ModelSelectionState as SelectionState,
} from "./chat-selections";
import {
	modelRefToId,
	pickDefaultModel,
	toKiloModelRef,
	type KiloModelCatalog,
	type KiloModelRef,
} from "./model-catalog";
import { normalizeEfforts, preserveEffort, resolveCatalogModel } from "./model-selection-utils";

const NO_RECENT_MODELS: readonly KiloModelRef[] = [];

/** kilo.core's model preferences with models as the picker names them. */
export interface PersistedModelPreferences {
	/** The model last picked for a new chat with each agent. */
	readonly modelSelections: Readonly<Record<string, KiloModelRef>>;
	/** The model and effort last picked for a new chat with any agent. */
	readonly preferred?: KiloModelRef & { readonly variant: string };
	/** Effort by `agent/provider/model`. */
	readonly variantSelections: Readonly<Record<string, string>>;
	readonly recentModels: readonly KiloModelRef[];
	readonly favorites: readonly KiloModelRef[];
}

export function persistedPreferences(preferences: ModelPreferences): PersistedModelPreferences {
	return {
		modelSelections: Object.fromEntries(
			Object.entries(preferences.byAgent).map(([agent, model]) => [agent, toKiloModelRef(model)]),
		),
		...(preferences.preferred
			? {
					preferred: {
						...toKiloModelRef(preferences.preferred),
						variant: preferences.preferred.variant,
					},
				}
			: {}),
		variantSelections: preferences.variants,
		recentModels: preferences.recent.map(toKiloModelRef),
		favorites: preferences.favorites.map(toKiloModelRef),
	};
}

const DEFAULT_SELECTION: SelectionState = {
	modelOverride: undefined,
	name: undefined,
	effort: undefined,
	efforts: undefined,
	effortByModel: {},
	dirty: false,
};

type AgentModelDefault = {
	agent: string;
	model?: KiloModelRef;
	effort?: string;
};

type RememberModelPreference = (
	agent: string,
	model: KiloModelRef,
	effort: string | undefined,
) => void;

type ChatScope = {
	/** The window's chat selections; without them a chat's selection lasts only as long as the hook. */
	readonly chats?: ChatSelections | undefined;
	/** The pane began as a draft, so the chat its first send creates starts from the draft's selection. */
	readonly startedAsDraft?: boolean;
	/** The pane opens an existing chat, so without a thread id it is still loading, not a draft. */
	readonly opensChat?: boolean;
};

function markLoaded(chatId: string) {
	return (current: Readonly<Record<string, true>>) =>
		current[chatId] ? current : { ...current, [chatId]: true as const };
}

function sameModel(left: KiloModelRef | undefined, right: KiloModelRef | undefined): boolean {
	return left?.providerID === right?.providerID && left?.modelID === right?.modelID;
}

function modelRef(model: KiloModelRef): KiloModelRef {
	return { providerID: model.providerID, modelID: model.modelID };
}

function variantKey(agent: string, model: KiloModelRef): string {
	return `${agent}/${model.providerID}/${model.modelID}`;
}

function normalizeEffort(effort: string | undefined): string | undefined {
	return effort || undefined;
}

function rememberModelEffort(
	effortByModel: SelectionState["effortByModel"],
	model: KiloModelRef | undefined,
	effort: string | undefined,
): SelectionState["effortByModel"] {
	if (!model) return effortByModel;
	const modelId = modelRefToId(model);
	const remembered = normalizeEffort(effort);
	if (effortByModel[modelId] === remembered) return effortByModel;
	const next = { ...effortByModel };
	if (remembered === undefined) delete next[modelId];
	else next[modelId] = remembered;
	return next;
}

function rememberedAgentEffort(
	preferences: PersistedModelPreferences | undefined,
	agent: string,
	model: KiloModelRef,
): string | undefined {
	return normalizeEffort(preferences?.variantSelections[variantKey(agent, model)]);
}

function catalogEntry(catalog: KiloModelCatalog | undefined, ref: KiloModelRef | undefined) {
	if (!catalog || !ref) {
		return undefined;
	}
	return catalog.models.find((model) => model.id === modelRefToId(ref));
}

function resolvePreference(
	catalog: KiloModelCatalog | undefined,
	model: KiloModelRef | undefined,
): KiloModelRef | undefined {
	if (catalog?.providerReady === false && model?.providerID === "kilo") return undefined;
	return resolveCatalogModel(catalog, model);
}

function automaticDefault(
	catalog: KiloModelCatalog | undefined,
	recentModels: readonly KiloModelRef[],
): KiloModelRef | undefined {
	if (!catalog) return undefined;
	if (catalog.providerReady === undefined) return pickDefaultModel(catalog);
	if (catalog.providerReady === false) {
		for (const recent of recentModels) {
			const resolved = resolveCatalogModel(catalog, recent);
			if (resolved && resolved.providerID !== "kilo") return resolved;
		}
		for (const provider of catalog.providers) {
			if (!provider.connected || provider.id === "kilo") continue;
			const defaultModelID = catalog.defaults[provider.id];
			const model = catalog.models.find(
				(candidate) =>
					candidate.providerID === provider.id &&
					!candidate.disabled &&
					(defaultModelID ? candidate.modelID === defaultModelID : true),
			);
			if (model) return { providerID: model.providerID, modelID: model.modelID };
		}
		return undefined;
	}
	if (catalog.organizationId) {
		const recommended = resolveCatalogModel(
			catalog,
			catalog.defaults.kilo ? { providerID: "kilo", modelID: catalog.defaults.kilo } : undefined,
		);
		if (recommended) return recommended;
		const firstKilo = catalog.models.find((model) => model.providerID === "kilo");
		return firstKilo ? { providerID: firstKilo.providerID, modelID: firstKilo.modelID } : undefined;
	}
	for (const recent of recentModels) {
		const resolved = resolveCatalogModel(catalog, recent);
		if (resolved) return resolved;
	}
	return (
		resolveCatalogModel(catalog, { providerID: "kilo", modelID: "kilo-auto/free" }) ??
		pickDefaultModel(catalog)
	);
}

/**
 * Thread-scoped model + sticky effort, hydrated from Kilo session state.
 * Unsent overrides stay in memory until Kilo persists them with the next prompt.
 * A chat's selection lives in the window's `ChatSelections`, so it survives
 * its pane; a draft's lives in the hook.
 *
 * A chat never borrows the "remembered for new chats" default (another
 * session's draft may have just changed it): until Kilo's session is read it
 * has no model, so a prompt sent meanwhile lets Kilo use the session's own.
 * Falls back to Auto Free (then another Kilo Auto model, then the catalog
 * default for non-Kilo providers) when the session has no model or its model
 * is no longer in the catalog; only a draft considers recent models there.
 */
export function usePersistedModelSelection(
	catalog: KiloModelCatalog | undefined,
	threadId?: string,
	agentDefault?: AgentModelDefault,
	preferences?: PersistedModelPreferences,
	onRemember?: RememberModelPreference,
	onRecent?: (model: KiloModelRef) => void,
	{ chats: windowChats, startedAsDraft = false, opensChat = false }: ChatScope = {},
) {
	const agent = agentDefault?.agent ?? "";
	const draftScope = `draft:${agent}`;
	const scope = threadId === undefined ? draftScope : `${threadId}:${agent}`;
	const [ownChats] = useState(() => new ChatSelections());
	const chats = windowChats ?? ownChats;
	const [drafts] = useState(() => new SelectionRecords<SelectionState>());
	const store = threadId === undefined ? drafts : chats.models;
	const draftSelections = useSelectionRecords(drafts);
	const chatSelections = useSelectionRecords(chats.models);
	const loadedChats = useSelectionRecords(chats.loaded);
	const preferredModel = resolvePreference(
		catalog,
		preferences?.preferred ? modelRef(preferences.preferred) : undefined,
	);
	const rememberedAgentModel = resolvePreference(catalog, preferences?.modelSelections[agent]);
	const configuredModel = resolvePreference(catalog, agentDefault?.model);
	const globalConfiguredModel = resolvePreference(catalog, catalog?.configuredModel);
	const defaultModel =
		preferredModel ??
		rememberedAgentModel ??
		configuredModel ??
		globalConfiguredModel ??
		automaticDefault(catalog, preferences?.recentModels ?? []);
	const defaultEffort = defaultModel
		? sameModel(defaultModel, preferences?.preferred)
			? normalizeEffort(preferences?.preferred?.variant)
			: (rememberedAgentEffort(preferences, agent, defaultModel) ??
				(sameModel(defaultModel, configuredModel) ? agentDefault?.effort : undefined))
		: undefined;
	const defaultSelection: SelectionState = defaultModel
		? { ...DEFAULT_SELECTION, modelOverride: defaultModel, effort: defaultEffort }
		: DEFAULT_SELECTION;
	const draftSelection = draftSelections[draftScope] ?? defaultSelection;
	const chatSelection = threadId === undefined ? undefined : chatSelections[scope];
	const awaitingKilo =
		threadId === undefined
			? opensChat
			: !startedAsDraft && chatSelection === undefined && !loadedChats[threadId];
	const selection = awaitingKilo
		? DEFAULT_SELECTION
		: threadId === undefined
			? draftSelection
			: (chatSelection ?? (startedAsDraft ? draftSelection : defaultSelection));
	// A pane opening a chat has no thread to keep a pick in yet, and it isn't a
	// draft, so a pick then must not become the remembered default.
	const opensUnknownChat = threadId === undefined && opensChat;
	const fallbackRecents =
		threadId === undefined ? (preferences?.recentModels ?? NO_RECENT_MODELS) : NO_RECENT_MODELS;

	// Before the catalog loads, surface the session selection so the trigger can
	// paint immediately. Once the catalog arrives, validate / fall back as usual.
	const validatedModel =
		catalog && !awaitingKilo
			? (resolvePreference(catalog, selection.modelOverride) ??
				automaticDefault(catalog, fallbackRecents))
			: undefined;
	const model = validatedModel ?? (catalog ? undefined : selection.modelOverride);

	const resolvedEntry = catalogEntry(catalog, model);
	const name = resolvedEntry?.name ?? selection.name;
	// Only fall back to sticky efforts while the catalog entry is unresolved;
	// a resolved model with no efforts must clear the previous model's list.
	const efforts = resolvedEntry ? normalizeEfforts(resolvedEntry.efforts) : selection.efforts;

	const setModel = (next: KiloModelRef) => {
		if (opensUnknownChat) return;
		const entry = catalogEntry(catalog, next);
		const nextEfforts = entry ? normalizeEfforts(entry.efforts) : selection.efforts;
		const effortByModel = rememberModelEffort(
			selection.effortByModel,
			selection.modelOverride,
			selection.effort,
		);
		const localEffort = effortByModel[modelRefToId(next)];
		const preferredEffort = sameModel(next, preferences?.preferred)
			? normalizeEffort(preferences?.preferred?.variant)
			: undefined;
		const agentEffort = rememberedAgentEffort(preferences, agent, next);
		const nextEffort = entry
			? ([localEffort, preferredEffort, agentEffort].find((effort) =>
					nextEfforts?.some(({ id }) => id === effort),
				) ?? preserveEffort(selection.effort, nextEfforts))
			: (localEffort ?? preferredEffort ?? agentEffort ?? selection.effort);
		store.update((current) => {
			const active = current[scope] ?? selection;
			const nextName = entry?.name ?? active.name;
			return {
				...current,
				[scope]: {
					...active,
					modelOverride: next,
					name: nextName,
					effort: nextEffort,
					efforts: nextEfforts,
					effortByModel,
					dirty: true,
				},
			};
		});
		if (threadId === undefined && agent) onRemember?.(agent, next, nextEffort);
		if (threadId !== undefined) onRecent?.(next);
	};

	const setEffort = (next: string) => {
		if (opensUnknownChat) return;
		const activeModel = model;
		store.update((current) => {
			const active = current[scope] ?? selection;
			if (activeModel) {
				const entry = catalogEntry(catalog, activeModel);
				const nextName = entry?.name ?? active.name;
				const nextEfforts = entry ? normalizeEfforts(entry.efforts) : active.efforts;
				return {
					...current,
					[scope]: {
						...active,
						modelOverride: activeModel,
						effort: next,
						name: nextName,
						efforts: nextEfforts,
						effortByModel: sameModel(activeModel, active.modelOverride)
							? active.effortByModel
							: rememberModelEffort(active.effortByModel, active.modelOverride, active.effort),
						dirty: true,
					},
				};
			}
			return { ...current, [scope]: { ...active, effort: next, dirty: true } };
		});
		if (threadId === undefined && agent && validatedModel) {
			onRemember?.(agent, validatedModel, next);
		}
	};
	const hydrateThreadModel = (
		id: string,
		next: { agent: string; model: KiloModelRef; effort?: string },
	) => {
		const hydratedScope = `${id}:${next.agent}`;
		chats.models.update((current) => {
			const existing = current[hydratedScope];
			const matches =
				existing?.modelOverride?.providerID === next.model.providerID &&
				existing.modelOverride.modelID === next.model.modelID &&
				existing.effort === next.effort;
			if (existing?.dirty && !matches) return current;
			if (matches && !existing.dirty) return current;
			return {
				...current,
				[hydratedScope]: {
					modelOverride: next.model,
					name: undefined,
					effort: next.effort,
					efforts: undefined,
					effortByModel: rememberModelEffort(
						existing?.effortByModel ?? DEFAULT_SELECTION.effortByModel,
						next.model,
						next.effort,
					),
					dirty: false,
				},
			};
		});
		chats.loaded.update(markLoaded(id));
	};
	/** Kilo's session was read but records no model: the chat starts from the defaults. */
	const markThreadLoaded = (id: string) => chats.loaded.update(markLoaded(id));
	const promoteDraftModel = (id: string) => {
		const draft = drafts.getSnapshot()[draftScope];
		chats.models.update((current) => ({
			...current,
			[`${id}:${agent}`]: draft ?? { ...defaultSelection, dirty: true },
		}));
	};
	const resetDraftModel = () => {
		drafts.update((current) => (Object.keys(current).length === 0 ? current : {}));
	};

	return {
		model,
		/** Catalog-validated model that is safe to send to Kilo. */
		validatedModel,
		/** A chat whose Kilo session hasn't been read yet, so its model is still unknown. */
		awaitingKilo,
		setModel,
		/** Display name for the optimistic trigger before the catalog loads. */
		name,
		effort: selection.effort,
		/** Effort options for the optimistic trigger before the catalog loads. */
		efforts,
		setEffort,
		hydrateThreadModel,
		markThreadLoaded,
		promoteDraftModel,
		resetDraftModel,
	};
}

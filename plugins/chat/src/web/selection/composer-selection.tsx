import { useAuiState } from "@assistant-ui/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	KiloAccount,
	Models,
	type AccountState,
	type GatewayModelDetails,
	type ModelsState,
} from "@kilo-desktop/plugin-core/contracts";
import { useChatConnection } from "../runtime/chat-connection";
import type { PromptModelRef } from "../runtime/prompt-options";
import { findCatalogAgent, type KiloAgentCatalog } from "./agent-catalog";
import { ChatAgentSelectionProvider } from "./ChatAgentSelectionContext";
import { ChatModelSelectionProvider, type ActiveModelSource } from "./ChatModelSelectionContext";
import { KiloSessionSelectionSync } from "./KiloSessionSelectionSync";
import {
	attachGatewayModelDetails,
	buildCatalogFromModels,
	modelRefToId,
	toModelRef,
	type CatalogAccount,
	type KiloModelRef,
} from "./model-catalog";
import { resolveModelEffort } from "./model-selector";
import { ModelSourceReader } from "./model-source";
import { KILO_PROVIDER_ID } from "./provider-ids";
import { useAgentSelection } from "./use-agent-selection";
import { useKiloAgentCatalog } from "./use-kilo-agent-catalog";
import { persistedPreferences, usePersistedModelSelection } from "./use-persisted-model-selection";

/** What the pane's next prompt is sent with. */
export interface PromptSelection {
	readonly agent?: string | undefined;
	readonly model?: PromptModelRef | undefined;
	readonly variant?: string | undefined;
}

const NO_DETAILS: readonly GatewayModelDetails[] = [];
const selectDetails = (state: ModelsState) => state.gatewayCatalog.details;
const selectModels = (state: ModelsState) => state;
const selectAccount = (state: AccountState) => state;

/** What the gateway answers for, from kilo.core's account. */
function catalogAccount(account: AccountState | undefined): CatalogAccount {
	if (!account) return {};
	return {
		...(account.connection === "pending"
			? {}
			: { providerReady: account.connection === "connected" }),
		organizationId: account.profile?.currentOrgId ?? null,
	};
}

/**
 * The picker's catalog from kilo.core's models, with the gateway's details
 * once it lists Kilo models (read in main, refreshed when older than a few
 * minutes). Pending until kilo.core has read the AI providers.
 */
function useModelCatalog() {
	const handle = useDomainObject(Models);
	const models = useDomainObjectState(Models, selectModels);
	const account = useDomainObjectState(KiloAccount, selectAccount);
	const details = useDomainObjectState(Models, selectDetails) ?? NO_DETAILS;
	const { providerReady, organizationId = null } = catalogAccount(account);
	const ready = models?.ready === true;
	const aiProviders = models?.aiProviders;
	const entries = models?.models;
	const defaults = models?.defaults;
	const configuredModel = models?.configuredModel;
	const base = useMemo(
		() =>
			ready && aiProviders && entries
				? buildCatalogFromModels(
						{
							aiProviders,
							models: entries,
							defaults: defaults ?? {},
							...(configuredModel ? { configuredModel } : {}),
						},
						{
							...(providerReady === undefined ? {} : { providerReady }),
							organizationId,
						},
					)
				: undefined,
		[ready, aiProviders, entries, defaults, configuredModel, providerReady, organizationId],
	);
	const hasKiloModels = base?.models.some((model) => model.providerID === KILO_PROVIDER_ID);
	useEffect(() => {
		if (hasKiloModels) void handle?.methods.refreshGatewayCatalog(undefined).catch(() => undefined);
	}, [handle, hasKiloModels]);
	const catalog = useMemo(() => attachGatewayModelDetails(base, [...details]), [base, details]);
	const refetch = useCallback(async () => handle?.methods.refresh(undefined), [handle]);
	const refresh = useCallback(() => void refetch().catch(() => undefined), [refetch]);
	return {
		catalog,
		isPending: !ready,
		/** Still the previous account's models, until kilo.core reads them for the new one. */
		isFollowingAccount: models?.followingAccount === true,
		preferences: models?.preferences,
		handle,
		refresh,
		refetch,
	};
}

/**
 * The agent pane's agent and model selection, for its pickers and its
 * prompts. A draft starts from the remembered choices (what is picked there
 * is remembered for new chats); a chat follows what Kilo recorded for it
 * until the person picks something else (recorded as recent). The draft's
 * selection carries over to the chat its first send creates.
 */
export function ComposerSelectionProvider({
	draft,
	onSelection,
	children,
}: {
	/**
	 * The thread starts without a chat, so the chat it shows later is the one
	 * its first send created. A thread opening a chat only learns the chat's
	 * id once it loads, which must not count as a send.
	 */
	readonly draft: boolean;
	readonly onSelection: (selection: PromptSelection) => void;
	readonly children: ReactNode;
}) {
	const { connection } = useChatConnection();
	const chatId = useAuiState((state) => state.threadListItem.remoteId);
	const agentCatalog = useKiloAgentCatalog(connection);
	const modelCatalog = useModelCatalog();
	const { catalog, handle: modelsHandle } = modelCatalog;
	const preferences = useMemo(
		() => (modelCatalog.preferences ? persistedPreferences(modelCatalog.preferences) : undefined),
		[modelCatalog.preferences],
	);
	const remember = useCallback(
		(agent: string, model: KiloModelRef, effort: string | undefined) =>
			void modelsHandle?.methods
				.remember({
					agent,
					model: toModelRef(model),
					...(effort === undefined ? {} : { variant: effort }),
				})
				.catch(() => undefined),
		[modelsHandle],
	);
	const recordRecent = useCallback(
		(model: KiloModelRef) =>
			void modelsHandle?.methods.recordRecent(toModelRef(model)).catch(() => undefined),
		[modelsHandle],
	);

	const agentSelection = useAgentSelection(agentCatalog.data, chatId);
	const configuredAgent = findCatalogAgent(agentCatalog.data, agentSelection.agent);
	const modelSelection = usePersistedModelSelection(
		catalog,
		chatId,
		configuredAgent
			? {
					agent: configuredAgent.name,
					...(configuredAgent.model ? { model: configuredAgent.model } : {}),
					...(configuredAgent.variant ? { effort: configuredAgent.variant } : {}),
				}
			: undefined,
		preferences,
		remember,
		recordRecent,
	);

	const { promoteDraftAgent } = agentSelection;
	const { promoteDraftModel } = modelSelection;
	const shownChatId = useRef(chatId);
	const startedAsDraft = useRef(draft).current;
	useLayoutEffect(() => {
		if (startedAsDraft && !shownChatId.current && chatId) {
			promoteDraftAgent(chatId);
			promoteDraftModel(chatId);
		}
		shownChatId.current = chatId;
	}, [chatId, promoteDraftAgent, promoteDraftModel, startedAsDraft]);

	const { validatedModel, effort } = modelSelection;
	const activeEffort = resolveModelEffort(
		catalog?.models ?? [],
		validatedModel ? modelRefToId(validatedModel) : undefined,
		effort,
	);
	onSelection({
		agent: agentSelection.getAgent(),
		model: validatedModel,
		variant: activeEffort,
	});

	const agentValue = useMemo(
		() => ({
			agent: agentSelection.agent,
			setAgent: agentSelection.setAgent,
			catalog: agentCatalog.data as KiloAgentCatalog | undefined,
			isCatalogPending: agentCatalog.isPending,
			isCatalogError: agentCatalog.isError,
		}),
		[
			agentSelection.agent,
			agentSelection.setAgent,
			agentCatalog.data,
			agentCatalog.isPending,
			agentCatalog.isError,
		],
	);
	const {
		refresh: refreshCatalog,
		refetch: refetchCatalog,
		isPending: isCatalogPending,
		isFollowingAccount,
	} = modelCatalog;
	const modelValue = useMemo(
		() => ({
			model: modelSelection.model,
			setModel: modelSelection.setModel,
			effort: modelSelection.effort,
			setEffort: modelSelection.setEffort,
			name: modelSelection.name,
			efforts: modelSelection.efforts,
			catalog,
			isCatalogPending,
			isCatalogError: false,
			isCatalogFetching: isFollowingAccount,
			refreshCatalog,
		}),
		[catalog, isCatalogPending, isFollowingAccount, modelSelection, refreshCatalog],
	);

	return (
		<ChatAgentSelectionProvider value={agentValue}>
			<ModelSourceReader onModelsChanged={refreshCatalog}>
				{(source) => (
					<ModelSelectionValue value={modelValue} source={source} refreshCatalog={refetchCatalog}>
						<KiloSessionSelectionSync
							hydrateAgent={agentSelection.hydrateThreadAgent}
							hydrateModel={modelSelection.hydrateThreadModel}
						/>
						{children}
					</ModelSelectionValue>
				)}
			</ModelSourceReader>
		</ChatAgentSelectionProvider>
	);
}

/** The model selection with the window's model source; its start reads the catalog again. */
function ModelSelectionValue({
	value,
	source,
	refreshCatalog,
	children,
}: {
	readonly value: Omit<Parameters<typeof ChatModelSelectionProvider>[0]["value"], "modelSource">;
	readonly source: ActiveModelSource | undefined;
	readonly refreshCatalog: () => Promise<unknown>;
	readonly children: ReactNode;
}) {
	const start = source?.start;
	const modelSource = useMemo(
		() =>
			source && {
				...source,
				start:
					start &&
					(async () => {
						await start();
						await refreshCatalog();
					}),
			},
		[source, start, refreshCatalog],
	);
	const withSource = useMemo(
		() => (modelSource ? { ...value, modelSource } : value),
		[modelSource, value],
	);
	return <ChatModelSelectionProvider value={withSource}>{children}</ChatModelSelectionProvider>;
}

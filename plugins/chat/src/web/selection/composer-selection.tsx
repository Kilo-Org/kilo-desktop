import { useAuiState } from "@assistant-ui/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	KiloAccount,
	Models,
	type AccountState,
	type GatewayModelDetails,
	type ModelsState,
} from "@kilo-desktop/plugin-core/contracts";
import { useChatConnection, useChatSelections } from "../runtime/chat-connection";
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
// What the gateway answers for, from kilo.core's account.
const selectProviderReady = (account: AccountState): CatalogAccount["providerReady"] =>
	account.connection === "pending" ? undefined : account.connection === "connected";
const selectOrganizationId = (account: AccountState) => account.profile?.organizationId ?? null;

/**
 * The picker's catalog from kilo.core's models, with the gateway's details
 * once it lists Kilo models (read in main, refreshed when older than a few
 * minutes). Pending until kilo.core has read the AI providers.
 */
function useModelCatalog() {
	const handle = useDomainObject(Models);
	const models = useDomainObjectState(Models, selectModels);
	const providerReady = useDomainObjectState(KiloAccount, selectProviderReady);
	const organizationId = useDomainObjectState(KiloAccount, selectOrganizationId) ?? null;
	const details = useDomainObjectState(Models, selectDetails) ?? NO_DETAILS;
	const ready = models?.ready === true;
	const aiProviders = models?.aiProviders;
	const entries = models?.models;
	const defaults = models?.defaults;
	const configuredModel = models?.configuredModel;
	const base =
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
			: undefined;
	const hasKiloModels = base?.models.some((model) => model.providerID === KILO_PROVIDER_ID);
	const catalog = attachGatewayModelDetails(base, [...details]);
	useEffect(() => {
		if (hasKiloModels) void handle?.methods.refreshGatewayCatalog(undefined).catch(() => undefined);
	}, [handle, hasKiloModels]);
	const refetch = async () => handle?.methods.refresh(undefined);
	const refresh = () => void refetch().catch(() => undefined);
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
	const preferences = modelCatalog.preferences
		? persistedPreferences(modelCatalog.preferences)
		: undefined;
	const remember = (agent: string, model: KiloModelRef, effort: string | undefined) =>
		void modelsHandle?.methods
			.remember({
				agent,
				model: toModelRef(model),
				...(effort === undefined ? {} : { variant: effort }),
			})
			.catch(() => undefined);
	const recordRecent = (model: KiloModelRef) =>
		void modelsHandle?.methods.recordRecent(toModelRef(model)).catch(() => undefined);

	const chats = useChatSelections();
	// Captures whether the pane started as a draft, once: it must not follow `draft` later.
	// react-doctor-disable-next-line react-doctor/no-derived-useState
	const [startedAsDraft] = useState(draft);
	const agentSelection = useAgentSelection(agentCatalog.data, chatId, chats);
	const configuredAgent = findCatalogAgent(agentCatalog.data, agentSelection.agent);
	// Until the agent catalog loads, the selected agent alone still finds the
	// chat's model, which is kept per agent.
	const modelSelection = usePersistedModelSelection(
		catalog,
		chatId,
		configuredAgent
			? {
					agent: configuredAgent.name,
					...(configuredAgent.model ? { model: configuredAgent.model } : {}),
					...(configuredAgent.variant ? { effort: configuredAgent.variant } : {}),
				}
			: agentSelection.agent
				? { agent: agentSelection.agent }
				: undefined,
		preferences,
		remember,
		recordRecent,
		{ chats, startedAsDraft, opensChat: !draft },
	);

	const { promoteDraftAgent } = agentSelection;
	const { promoteDraftModel } = modelSelection;
	const shownChatId = useRef(chatId);
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
	const selectedAgent = agentSelection.agent;
	// A layout effect so the selection lands before the parent's passive
	// effects (the first-prompt handover) and any event can send with it.
	// The parent stores the selection in a ref, so reporting it re-renders nothing.
	useLayoutEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect
		onSelection({ agent: selectedAgent, model: validatedModel, variant: activeEffort });
	}, [onSelection, selectedAgent, validatedModel, activeEffort]);

	const agentValue = {
		agent: agentSelection.agent,
		setAgent: agentSelection.setAgent,
		catalog: agentCatalog.data as KiloAgentCatalog | undefined,
		isCatalogPending: agentCatalog.isPending,
		isCatalogError: agentCatalog.isError,
	};
	const {
		refresh: refreshCatalog,
		refetch: refetchCatalog,
		isPending: isCatalogPending,
		isFollowingAccount,
	} = modelCatalog;
	const modelValue = {
		model: modelSelection.model,
		setModel: modelSelection.setModel,
		effort: modelSelection.effort,
		setEffort: modelSelection.setEffort,
		name: modelSelection.name,
		efforts: modelSelection.efforts,
		catalog,
		isCatalogPending,
		isSelectionPending: modelSelection.awaitingKilo,
		isCatalogError: false,
		isCatalogFetching: isFollowingAccount,
		refreshCatalog,
	};

	return (
		<ChatAgentSelectionProvider value={agentValue}>
			<ModelSourceReader onModelsChanged={refreshCatalog}>
				{(source) => (
					<ModelSelectionValue value={modelValue} source={source} refreshCatalog={refetchCatalog}>
						<KiloSessionSelectionSync
							hydrateAgent={agentSelection.hydrateThreadAgent}
							hydrateModel={modelSelection.hydrateThreadModel}
							markLoaded={modelSelection.markThreadLoaded}
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
	const modelSource = source && {
		...source,
		start:
			start &&
			(async () => {
				await start();
				await refreshCatalog();
			}),
	};
	const withSource = modelSource ? { ...value, modelSource } : value;
	return <ChatModelSelectionProvider value={withSource}>{children}</ChatModelSelectionProvider>;
}

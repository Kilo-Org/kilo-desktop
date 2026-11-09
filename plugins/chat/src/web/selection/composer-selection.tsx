import { useAuiState } from "@assistant-ui/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";

import {
	GatewayModels,
	ModelPreferences,
	type GatewayModelDetails,
	type ModelPreferencesState,
} from "../../contracts";
import { useChatConnection } from "../runtime/chat-connection";
import type { PromptModelRef } from "../runtime/prompt-options";
import { findCatalogAgent, type KiloAgentCatalog } from "./agent-catalog";
import { ChatAgentSelectionProvider } from "./ChatAgentSelectionContext";
import { ChatModelSelectionProvider, type ActiveModelSource } from "./ChatModelSelectionContext";
import { KiloSessionSelectionSync } from "./KiloSessionSelectionSync";
import {
	attachGatewayModelDetails,
	modelRefToId,
	type KiloModelCatalog,
	type KiloModelRef,
} from "./model-catalog";
import { resolveModelEffort } from "./model-selector";
import { ModelSourceReader } from "./model-source";
import { KILO_PROVIDER_ID } from "./provider-ids";
import { useAgentSelection } from "./use-agent-selection";
import { useKiloAgentCatalog } from "./use-kilo-agent-catalog";
import { isModelCatalogPending, useKiloModelCatalog } from "./use-kilo-model-catalog";
import { usePersistedModelSelection } from "./use-persisted-model-selection";

/** What the pane's next prompt is sent with. */
export interface PromptSelection {
	readonly agent?: string | undefined;
	readonly model?: PromptModelRef | undefined;
	readonly variant?: string | undefined;
}

const NO_DETAILS: readonly GatewayModelDetails[] = [];
const selectDetails = (state: { details: readonly GatewayModelDetails[] }) => state.details;
const selectPreferences = (state: ModelPreferencesState) => state;

/** The Kilo Gateway's model details, read in main once the catalog lists Kilo models. */
function useGatewayDetails(catalog: KiloModelCatalog | undefined): readonly GatewayModelDetails[] {
	const gateway = useDomain(GatewayModels);
	const details = useDomainState(GatewayModels, selectDetails) ?? NO_DETAILS;
	const hasKiloModels = catalog?.models.some((model) => model.providerID === KILO_PROVIDER_ID);
	useEffect(() => {
		if (hasKiloModels) void gateway?.methods.refresh(undefined).catch(() => undefined);
	}, [gateway, hasKiloModels]);
	return details;
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
	const modelCatalog = useKiloModelCatalog(connection);
	const details = useGatewayDetails(modelCatalog.data);
	const catalog = useMemo(
		() => attachGatewayModelDetails(modelCatalog.data, [...details]),
		[modelCatalog.data, details],
	);
	const preferencesHandle = useDomain(ModelPreferences);
	const preferences = useDomainState(ModelPreferences, selectPreferences) ?? undefined;
	const remember = useCallback(
		(agent: string, model: KiloModelRef, effort: string | undefined) =>
			void preferencesHandle?.methods
				.remember({ agent, model, ...(effort === undefined ? {} : { effort }) })
				.catch(() => undefined),
		[preferencesHandle],
	);
	const recordRecent = useCallback(
		(model: KiloModelRef) =>
			void preferencesHandle?.methods.recordRecent(model).catch(() => undefined),
		[preferencesHandle],
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
		modelCatalog.data?.models ?? [],
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
	const { refetch: refetchCatalog } = modelCatalog;
	const refreshCatalog = useCallback(
		() => void refetchCatalog().catch(() => undefined),
		[refetchCatalog],
	);
	const modelValue = useMemo(
		() => ({
			model: modelSelection.model,
			setModel: modelSelection.setModel,
			effort: modelSelection.effort,
			setEffort: modelSelection.setEffort,
			name: modelSelection.name,
			efforts: modelSelection.efforts,
			catalog,
			isCatalogPending: isModelCatalogPending(modelCatalog),
			isCatalogError: modelCatalog.isError,
			isCatalogFetching: modelCatalog.isFetching,
			refreshCatalog,
		}),
		[catalog, modelCatalog, modelSelection, refreshCatalog],
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

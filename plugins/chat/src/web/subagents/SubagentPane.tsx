import { ReadonlyThreadProvider, useAuiState } from "@assistant-ui/react";
import { BotIcon, CircleAlertIcon } from "lucide-react";
import { useCallback, type FC, type ReactNode } from "react";

import type { DomainState } from "@kilo-desktop/kernel";
import { useDomainState } from "@kilo-desktop/kernel/web";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";
import { Sessions, type PaneProps } from "@kilo-desktop/plugin-sessions/contracts";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { CHAT_ID_METADATA_KEY, SUBAGENT_CHILD_SESSION_METADATA_KEY } from "../../contracts";
import { PendingInteractionPrompt } from "../interactions/opencode-composer-interaction";
import {
	PendingInteractionsScope,
	usePendingInteractions,
} from "../interactions/PendingInteractionsContext";
import { ChatPaneOpeners } from "../panes/chat-pane-openers";
import { ChatMirror, type ChatMirrorServices } from "../runtime/chat-mirror";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import { ReadonlyThread } from "../thread/thread";
import { TranscriptProviders } from "../thread/transcript-scope";
import { childSessionIdForToolCall, selectSubagentTranscript } from "./subagent-state";

const EMPTY_MESSAGES: readonly never[] = [];

export const SubagentIcon: FC<{ className?: string }> = ({ className }) => (
	<BotIcon className={className} />
);

/**
 * The subagent pane: one child chat's transcript, read-only, with the prompt
 * it is waiting on. It runs its own runtime for the chat that delegated it
 * (named in the pane, else kilo.agent's record of the child's parent, else
 * the session's first chat for origin's panes) and finds the child there.
 */
export function createSubagentPane(services: ChatMirrorServices): FC<PaneProps> {
	return function SubagentPane({ sessionId, pane }) {
		const childSessionId = pane.metadata[SUBAGENT_CHILD_SESSION_METADATA_KEY];
		const recordedParent = useDomainState(
			Conversations,
			useCallback(
				(state: DomainState<typeof Conversations>) =>
					childSessionId ? (state.chats[childSessionId]?.parentId ?? null) : null,
				[childSessionId],
			),
		);
		const firstChat = useDomainState(
			Sessions,
			useCallback(
				(state: DomainState<typeof Sessions>) =>
					state.sessions.find((candidate) => candidate.id === sessionId)?.chatIds[0] ?? null,
				[sessionId],
			),
		);
		const parentChatId = pane.metadata[CHAT_ID_METADATA_KEY] ?? recordedParent ?? firstChat ?? null;
		const workspaceFolders = useDomainState(
			Conversations,
			useCallback(
				(state: DomainState<typeof Conversations>) =>
					parentChatId ? state.chats[parentChatId]?.workspaceFolders : undefined,
				[parentChatId],
			),
		);

		return (
			<div className="bg-pane flex h-full min-h-0 flex-col" data-qa-id="kilo-subagent-pane">
				<ChatMirror services={services} sessionId={sessionId} chatId={parentChatId}>
					<ChatPaneOpeners sessionId={sessionId} chatId={childSessionId ?? null}>
						<TranscriptProviders sessionId={sessionId} workspaceFolders={workspaceFolders ?? []}>
							<SubagentView childSessionId={childSessionId} />
						</TranscriptProviders>
					</ChatPaneOpeners>
				</ChatMirror>
			</div>
		);
	};
}

/**
 * Answers this subagent's prompts from its pane. The chat composer shows the
 * same prompt, so the Enter shortcut stays with the composer.
 */
function SubagentPanePrompt() {
	const { permissions, questions } = usePendingInteractions();
	if (permissions.length === 0 && questions.length === 0) return null;
	return (
		<div className="shrink-0 p-3" data-qa-id="subagent-pane-prompt">
			<PendingInteractionPrompt fallback={null} acceptOnEnter={false} />
		</div>
	);
}

export function SubagentView({ childSessionId }: { childSessionId: string | undefined }) {
	if (!childSessionId) return <SubagentTranscript childSessionId={undefined} />;
	return (
		<PendingInteractionsScope sessionId={childSessionId}>
			<div className="flex min-h-0 flex-1 flex-col">
				<SubagentTranscript childSessionId={childSessionId} />
				<SubagentPanePrompt />
			</div>
		</PendingInteractionsScope>
	);
}

function SubagentTranscript({ childSessionId }: { childSessionId: string | undefined }): ReactNode {
	const extras = useOptionalOpenCodeRuntimeExtras();
	const messages = useAuiState((state) => {
		if (!childSessionId) return EMPTY_MESSAGES;
		for (const message of state.thread.messages) {
			const rawParts = (message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined)
				?.opencode?.parts;
			for (const part of message.content) {
				if (
					part.type === "tool-call" &&
					childSessionIdForToolCall(rawParts, part.toolCallId) === childSessionId
				) {
					return part.messages ?? EMPTY_MESSAGES;
				}
			}
		}
		return EMPTY_MESSAGES;
	});
	const transcript = childSessionId
		? selectSubagentTranscript(extras?.state, childSessionId, messages)
		: { type: "unavailable" as const };

	if (transcript.type === "loading") {
		return (
			<div
				className="text-muted-foreground grid min-h-0 flex-1 place-items-center text-sm"
				data-qa-id="subagent-pane-loading"
			>
				<div className="flex items-center gap-2">
					<Spinner className="size-4" />
					Loading subagent conversation...
				</div>
			</div>
		);
	}
	if (transcript.type !== "ready") {
		return (
			<div
				className="text-muted-foreground grid min-h-0 flex-1 place-items-center p-6 text-center"
				data-qa-id="subagent-pane-unavailable"
			>
				<div className="flex max-w-sm flex-col items-center gap-2">
					<CircleAlertIcon className="size-5" />
					<p className="text-foreground text-sm font-medium">Subagent conversation unavailable</p>
					<p className="text-xs">The child session could not be restored from this task.</p>
				</div>
			</div>
		);
	}
	if (transcript.messages.length === 0) {
		return (
			<div
				className="text-muted-foreground grid min-h-0 flex-1 place-items-center text-sm"
				data-qa-id="subagent-pane-empty"
			>
				<div className="flex items-center gap-2">
					<BotIcon className="size-4" />
					Waiting for subagent activity...
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-qa-id="subagent-pane-transcript">
			<ReadonlyThreadProvider messages={transcript.messages}>
				<ReadonlyThread />
			</ReadonlyThreadProvider>
		</div>
	);
}

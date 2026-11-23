import { ReadonlyThreadProvider, useAuiState } from "@assistant-ui/react";
import { BotIcon, CircleAlertIcon } from "lucide-react";
import type { FC, ReactNode } from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import { Panes, WorkSessions, type PaneProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { Composer, subagentPaneChildChatId, subagentPaneParentChatId } from "../../contracts";
import { PendingInteractionPrompt } from "../interactions/opencode-composer-interaction";
import {
	PendingInteractionsScope,
	usePendingInteractions,
} from "../interactions/PendingInteractionsContext";
import { ChatPaneOpeners } from "../panes/chat-pane-openers";
import { SubagentPaneHeader } from "../swarm/SubagentPaneHeader";
import { teamRootOf } from "../swarm/swarm-colors";
import { focusChatComposer } from "../swarm/swarm-pane-actions";
import { ChatMirror, type ChatMirrorServices } from "../runtime/chat-mirror";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import { ReadonlyThread } from "../thread/thread";
import { TranscriptProviders } from "../thread/transcript-scope";
import { FirstUserMessageCaptionContext } from "../thread/user-message-caption";
import { childSessionIdForToolCall, selectSubagentTranscript } from "./subagent-state";

const EMPTY_MESSAGES: readonly never[] = [];

export const SubagentIcon: FC<{ className?: string }> = ({ className }) => (
	<BotIcon className={className} />
);

/**
 * The subagent pane: one child chat's transcript (the chat its `object`
 * names), read-only, with the prompt it is waiting on, headed in the worker's
 * team color (as the Swarm Board shows it). Its first prompt is the task the
 * main agent gave it; the main agent steers it, so the footer points the
 * person to the main chat. It runs its own
 * runtime for the chat that delegated it (kilo.core's current record of the
 * child's parent, else the pane's hint, else the work session's first chat for
 * origin's panes) and finds the child there.
 */
export function createSubagentPane(services: ChatMirrorServices): FC<PaneProps> {
	return (props) => <SubagentPane {...props} services={services} />;
}

function SubagentPane({
	workSessionId,
	pane,
	services,
}: PaneProps & { services: ChatMirrorServices }) {
	const childChatId = subagentPaneChildChatId(pane) ?? undefined;
	const recordedParent = useDomainObjectState(Chats, (state: DomainObjectState<typeof Chats>) =>
		childChatId ? (state.chats[childChatId]?.parentId ?? null) : null,
	);
	const firstChat = useDomainObjectState(
		WorkSessions,
		(state: DomainObjectState<typeof WorkSessions>) =>
			state.workSessions.find((candidate) => candidate.id === workSessionId)?.chatIds[0] ?? null,
	);
	const parentChatId = recordedParent ?? subagentPaneParentChatId(pane) ?? firstChat ?? null;
	const workspaceFolders = useDomainObjectState(Chats, (state: DomainObjectState<typeof Chats>) =>
		parentChatId ? state.chats[parentChatId]?.workspaceFolders : undefined,
	);

	return (
		<div className="bg-pane flex h-full min-h-0 flex-col" data-qa-id="kilo-subagent-pane">
			<SubagentPaneHeader
				workSessionId={workSessionId}
				childChatId={childChatId}
				parentHint={parentChatId}
			/>
			<ChatMirror services={services} workSessionId={workSessionId} chatId={parentChatId}>
				<ChatPaneOpeners workSessionId={workSessionId} chatId={childChatId ?? null}>
					<TranscriptProviders
						workSessionId={workSessionId}
						workspaceFolders={workspaceFolders ?? []}
					>
						<SubagentView childSessionId={childChatId} />
					</TranscriptProviders>
				</ChatPaneOpeners>
			</ChatMirror>
			{childChatId ? (
				<SubagentPaneFooter workSessionId={workSessionId} parentChatId={parentChatId} />
			) : null}
		</div>
	);
}

/** Points the person to the main agent, which is what steers its subagents. */
function SubagentPaneFooter({
	workSessionId,
	parentChatId,
}: {
	readonly workSessionId: string;
	readonly parentChatId: string | null;
}) {
	const panes = useDomainObject(Panes);
	const composer = useDomainObject(Composer);
	const mainChatId = useDomainObjectState(Chats, (state: DomainObjectState<typeof Chats>) =>
		parentChatId ? teamRootOf(parentChatId, state.chats) : null,
	);
	const messageMain = () => {
		if (!panes || !mainChatId) return;
		void focusChatComposer(panes, composer, workSessionId, mainChatId).catch(() =>
			toast.error("Could not open the main chat"),
		);
	};
	return (
		<p
			className="text-muted-foreground shrink-0 px-3 py-2 text-center text-xs"
			data-qa-id="subagent-pane-footer"
		>
			Subagents are steered by the main agent.{" "}
			{panes && mainChatId ? (
				<button
					type="button"
					className="text-primary-ink underline-offset-2 hover:underline"
					onClick={messageMain}
					data-qa-id="subagent-pane-steer"
				>
					Message the main agent
				</button>
			) : null}
		</p>
	);
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
				<FirstUserMessageCaptionContext.Provider value="From the main agent">
					<ReadonlyThread />
				</FirstUserMessageCaptionContext.Provider>
			</ReadonlyThreadProvider>
		</div>
	);
}

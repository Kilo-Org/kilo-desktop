import type { ReactNode } from "react";
import { ReadonlyThreadProvider, useAuiState } from "@assistant-ui/react";
import { BotIcon, CircleAlertIcon } from "lucide-react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";

import type { ChatRightPanelContributionProps } from "../../session/right-panel/right-panel-tab-registry.js";
import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras.js";
import { ReadonlyThread } from "../components/assistant-ui/thread.js";
import { PendingInteractionPrompt } from "../components/tools/opencode-composer-interaction.js";
import { PendingInteractionsScope, usePendingInteractions } from "./PendingInteractionsContext.js";
import {
	SUBAGENT_CHILD_SESSION_METADATA_KEY,
	childSessionIdForToolCall,
	selectSubagentTranscript,
} from "./subagent-state.js";

const EMPTY_MESSAGES: readonly never[] = [];

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

export function SubagentPane({ metadata }: ChatRightPanelContributionProps) {
	const childSessionId = metadata?.[SUBAGENT_CHILD_SESSION_METADATA_KEY];
	if (!childSessionId) return <SubagentPaneBody childSessionId={undefined} />;
	return (
		<PendingInteractionsScope sessionId={childSessionId}>
			<div className="flex min-h-0 flex-1 flex-col">
				<SubagentPaneBody childSessionId={childSessionId} />
				<SubagentPanePrompt />
			</div>
		</PendingInteractionsScope>
	);
}

function SubagentPaneBody({ childSessionId }: { childSessionId: string | undefined }): ReactNode {
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

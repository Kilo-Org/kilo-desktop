import { BookOpenIcon, CircleAlertIcon, SendIcon } from "lucide-react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { BOARD_EVERYONE, Chats } from "@kilo-desktop/plugin-core/contracts";
import { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useBoardPostPlace } from "../swarm/board-post-lookup";
import { useSwarmBoardStore } from "../swarm/swarm-board-store";
import { openSwarmBoardPane } from "../swarm/swarm-pane-actions";
import { displayTitle } from "../swarm/swarm-team";
import { useOpenSwarmBoard } from "../swarm/use-open-swarm-board";
import { useChatMarkdownContext } from "../thread/chat-markdown";
import { useSoloInSubgroup } from "./tool-ui-activity-row";
import { isCancelledToolStatus, str, truncate } from "./tool-ui-shared";
import type { ToolCallComponent } from "./tool-call";

/** What Kilo's `board_post` returns: the posted message (JSON text). */
interface PostedMessage {
	readonly id: string;
	readonly from?: string;
	readonly toLabel?: string;
}

/** The posted message from the call's output, once it has one. */
export function postedMessage(result: unknown): PostedMessage | undefined {
	let value: unknown = result;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || !record.id) return undefined;
	return {
		id: record.id,
		...(typeof record.from === "string" ? { from: record.from } : {}),
		...(typeof record.toLabel === "string" ? { toLabel: record.toLabel } : {}),
	};
}

const firstLine = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean) ?? "";

/** How the transcript names a post's recipient: as the board does. */
function useRecipientName(
	to: string,
	rootChatId: string | undefined,
	kiloLabel: string | undefined,
): string {
	const title = useDomainObjectState(Chats, (state: DomainObjectState<typeof Chats>) =>
		to ? state.chats[to]?.title : undefined,
	);
	if (to === "main" || (rootChatId && to === rootChatId)) return "Main agent";
	if (to === BOARD_EVERYONE) return "Everyone";
	const name = title ?? kiloLabel;
	return name ? displayTitle(name) : "an agent";
}

/**
 * A `board_post` call as one row: "Posted to board → recipient", the post's
 * first line and its number on the board (`#n`) once the board says. Clicking
 * it opens the team's Swarm Board on the post.
 */
export const BoardPostActivity: ToolCallComponent = ({ args, result, status }) => {
	const record = args as Record<string, unknown> | undefined;
	const to = str(record?.to);
	const body = firstLine(str(record?.body));
	const posted = postedMessage(result);
	const transcriptChatId = useOpenSwarmBoard()?.rootChatId;
	const posterChatId = posted?.from?.startsWith("ses") ? posted.from : undefined;
	const place = useBoardPostPlace(transcriptChatId ?? posterChatId, posted?.id);
	const recipient = useRecipientName(to, place?.rootChatId, posted?.toLabel);
	const panes = useDomainObject(Panes);
	const workSessionId = useChatMarkdownContext()?.workSessionId;

	const running = status.type === "running";
	const cancelled = isCancelledToolStatus(status);
	const failed = status.type === "incomplete" && !cancelled;
	const messageId = posted?.id;
	const rootChatId = place?.rootChatId;
	const open =
		panes && workSessionId && rootChatId && messageId
			? () => {
					useSwarmBoardStore.getState().requestFocus(rootChatId, { kind: "post", messageId });
					void openSwarmBoardPane(panes, workSessionId, rootChatId).catch(() =>
						toast.error("Could not open the Swarm Board"),
					);
				}
			: undefined;

	const content = (
		<>
			{running ? (
				<Spinner className="size-3 shrink-0" />
			) : failed ? (
				<CircleAlertIcon aria-hidden className="text-destructive size-3 shrink-0" />
			) : (
				<SendIcon aria-hidden className="size-3 shrink-0" />
			)}
			<span
				className={cn("flex min-w-0 items-center gap-1.5", cancelled && "line-through opacity-50")}
			>
				<span className="shrink-0 font-medium">
					{running ? "Posting…" : failed ? "Could not post to board" : "Posted to board"}
				</span>
				{to ? (
					<span className="shrink-0" data-qa-id="kilo-board-post-recipient">
						→ {recipient}
					</span>
				) : null}
				{body ? <span className="truncate opacity-60">{truncate(body)}</span> : null}
			</span>
			{place?.number !== undefined ? (
				<span className="ms-auto shrink-0 text-xs tabular-nums" data-qa-id="kilo-board-post-number">
					#{place.number}
				</span>
			) : null}
		</>
	);

	return (
		<div
			className="text-muted-foreground flex min-w-0 items-center gap-2 py-0.5 text-sm"
			data-qa-id="kilo-board-post"
			data-status={status.type}
		>
			{open ? (
				<button
					type="button"
					className="hover:text-foreground flex min-w-0 flex-1 items-center gap-2 text-left transition-colors"
					onClick={open}
					aria-label={`Open on the Swarm Board: ${body || "post"}`}
				>
					{content}
				</button>
			) : (
				<div className="flex min-w-0 flex-1 items-center gap-2">{content}</div>
			)}
		</div>
	);
};
BoardPostActivity.displayName = "BoardPostActivity";

/** A `board_read` call: one muted line, nothing of what it read. */
export const BoardReadActivity: ToolCallComponent = ({ status }) => {
	const solo = useSoloInSubgroup("subagent");
	if (solo) return null;
	return (
		<div
			className="text-muted-foreground flex items-center gap-2 py-0.5 text-sm"
			data-qa-id="kilo-board-read"
		>
			{status.type === "running" ? (
				<Spinner className="size-3 shrink-0" />
			) : (
				<BookOpenIcon aria-hidden className="size-3 shrink-0" />
			)}
			<span className={cn(isCancelledToolStatus(status) && "line-through opacity-50")}>
				{status.type === "running" ? "Reading the board" : "Read the board"}
			</span>
		</div>
	);
};
BoardReadActivity.displayName = "BoardReadActivity";

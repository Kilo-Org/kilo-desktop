import { type useAui, useAuiState, type ThreadMessage } from "@assistant-ui/react";
import type { OpenCodeServerMessage } from "@assistant-ui/react-opencode";
import type { CreateAttachment } from "@assistant-ui/core";
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2/client";

import { selectOpenCodeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import { userPromptText } from "./retry-failed-prompt";

export type AuiClient = ReturnType<typeof useAui>;

/** Primitive subscription — subscribing to the extras object would re-render every action bar on each streaming delta. */
export const useHasOpenCodeExtras = (): boolean =>
	useAuiState((s) => selectOpenCodeExtras(s.thread.extras) != null);

/**
 * Whether this user message has been answered. Consecutive assistant messages
 * are fused by the projection, so the immediate-next-message check is
 * equivalent to the extension's `turn.assistant.length > 0` answered gating.
 */
export const useIsAnsweredPrompt = (): boolean =>
	useAuiState((s) => s.thread.messages[s.message.index + 1]?.role === "assistant");

export const useRevertBoundaryId = (): string | undefined =>
	useAuiState((s) => selectOpenCodeExtras(s.thread.extras)?.session?.revert?.messageID);

/**
 * Primitive selectors (messageID / workspace) rather than one object selector:
 * `useAuiState` compares by `Object.is`, so object literals would re-render on
 * every store update — separate primitives notice workspace-only updates
 * without churn.
 */
export const useRevertWorkspace = ():
	| "restored"
	| "snapshots-disabled"
	| "unavailable"
	| "not-a-git-repo"
	| undefined =>
	useAuiState((s) => selectOpenCodeExtras(s.thread.extras)?.session?.revert?.workspace);

/**
 * Raw `session.summary.diffs` array by reference — safe for `Object.is` because
 * the patched runtime replaces `state.session` only on `session.updated` /
 * `history.loaded`, never on streaming deltas. Callers filter/sum during
 * render; deriving here would re-render on every store update.
 */
export const useRevertDiffs = (): SnapshotFileDiff[] | undefined =>
	useAuiState((s) => selectOpenCodeExtras(s.thread.extras)?.session?.summary?.diffs);

/**
 * Whether any user turn at or after this message recorded file changes
 * (`info.summary.diffs`). Gates RevertToHereButton so ranges without recorded
 * workspace changes keep the button hidden. Boolean primitive — safe for
 * `Object.is`; short-circuits on the first hit.
 */
export const useRevertRangeHasFileChanges = (): boolean =>
	useAuiState((s) => {
		const extras = selectOpenCodeExtras(s.thread.extras);
		if (!extras) return false;
		const { indexById, lastChangedUserIndex } = fileChangeIndex(extras.state);
		const messageIndex = indexById.get(s.message.id);
		return messageIndex !== undefined && messageIndex <= lastChangedUserIndex;
	});

type ThreadState = NonNullable<ReturnType<typeof selectOpenCodeExtras>>["state"];

interface FileChangeIndex {
	readonly indexById: ReadonlyMap<string, number>;
	/** The last user message that recorded file changes; -1 when none did. */
	readonly lastChangedUserIndex: number;
}

/*
 * Every user message asks this on every store update, so it is computed once
 * per thread state: scanning the rest of the thread per message made each
 * streamed token cost O(messages²).
 */
const fileChangeIndexes = new WeakMap<ThreadState, FileChangeIndex>();

function fileChangeIndex(state: ThreadState): FileChangeIndex {
	const cached = fileChangeIndexes.get(state);
	if (cached) return cached;
	const indexById = new Map<string, number>();
	let lastChangedUserIndex = -1;
	state.messageOrder.forEach((messageId, index) => {
		indexById.set(messageId, index);
		const info = state.messagesById[messageId]?.info;
		if (info?.role === "user" && (info.summary?.diffs?.length ?? 0) > 0) {
			lastChangedUserIndex = index;
		}
	});
	const index = { indexById, lastChangedUserIndex };
	fileChangeIndexes.set(state, index);
	return index;
}

export type ComposerPrompt = {
	text: string;
	attachments: readonly CreateAttachment[];
};

/**
 * The composer operations a restore needs; the thread's composer, a
 * message's edit composer and a runtime's composer all have them.
 */
export interface RestorableComposer {
	setText(text: string): void;
	addAttachment(attachment: CreateAttachment): Promise<void>;
	clearAttachments(): Promise<void>;
}

export async function restoreToComposer(
	composer: RestorableComposer,
	prompt: ComposerPrompt,
): Promise<void> {
	// Replace, not prepend: the restored prompt becomes the new draft.
	composer.setText(prompt.text);
	// Cleared unconditionally and re-added, rather than diffed against
	// `getState()`: an edit composer's state lags the composer it was just
	// opened as, and adding a complete attachment twice duplicates it.
	// A failed clear or attachment must not block the restore.
	await composer.clearAttachments().catch(() => undefined);
	for (const attachment of prompt.attachments) {
		await composer.addAttachment(attachment).catch(() => undefined);
	}
}

/** A prompt shown in the thread (a `ThreadMessage`) or sent from a composer (an `AppendMessage`). */
type PromptMessage = Pick<ThreadMessage, "content" | "attachments">;

export function messageToComposerPrompt(message: PromptMessage): ComposerPrompt {
	return {
		text: userPromptText(message) ?? "",
		attachments: (message.attachments ?? []).map((attachment) => ({
			id: attachment.id,
			type: attachment.type,
			name: attachment.name,
			...(attachment.contentType != null ? { contentType: attachment.contentType } : {}),
			content: attachment.content,
		})),
	};
}

/**
 * Restores the conversation through the target user message: moves the
 * boundary forward to the next user message and stages its prompt into the
 * composer (the composer always holds the current boundary message's prompt),
 * or unreverts outright when the target is the last reverted user message.
 * Click-time read (no render subscription); no-op when no revert is pending;
 * throws on failure so callers can toast.
 */
export async function restoreThroughUserMessage(aui: AuiClient, targetId: string): Promise<void> {
	const extras = selectOpenCodeExtras(aui.thread.getState().extras);
	const boundaryId = extras?.session?.revert?.messageID;
	if (!extras || !boundaryId) return;
	const targetIndex = extras.state.messageOrder.indexOf(targetId);
	if (targetIndex === -1) return;
	let next: OpenCodeServerMessage | undefined;
	for (let i = targetIndex + 1; i < extras.state.messageOrder.length; i++) {
		const msgId = extras.state.messageOrder[i];
		if (msgId === undefined) continue;
		const message = extras.state.messagesById[msgId];
		if (message?.info?.role === "user") {
			next = message;
			break;
		}
	}
	if (next) {
		await extras.revert(next.id);
		await restoreToComposer(aui.thread.composer(), serverMessageToComposerPrompt(next));
	} else {
		await extras.unrevert();
		// Full undo clears text only — attachments added by an earlier restore
		// stay in the composer (deliberate divergence: the extension's
		// `unrevertSession` clears the entire prompt input including all
		// attachment kinds; desktop keeps all attachments).
		aui.thread.composer().setText("");
	}
}

// Mirrors the projection's convertFilePart so restored attachments match how
// the original message rendered them.
export const attachmentFromServerFilePart = (
	part: Extract<OpenCodeServerMessage["parts"][number], { type: "file" }>,
): CreateAttachment => {
	const mimeType = part.mime ?? "application/octet-stream";
	if (mimeType.startsWith("image/")) {
		return {
			id: part.id,
			type: "image",
			name: part.filename ?? "file",
			contentType: mimeType,
			content: [{ type: "image", image: part.url ?? "" }],
		};
	}
	return {
		id: part.id,
		type: "file",
		name: part.filename ?? "file",
		contentType: mimeType,
		content: [{ type: "file", data: part.url ?? "", mimeType }],
	};
};

/**
 * Known limitation: messages whose `parts` were emptied by `retryFailedTurn`
 * (`promptAsync({ messageID, parts: [] })`) restore as empty text because
 * `shadowParts` — a client-side projection fallback — are not visible here.
 * Accepted: this path targets the *next* user message during a Restore step,
 * not the clicked boundary message; the primary revert-to-here flow goes
 * through `messageToComposerPrompt`, which reads the projected ThreadMessage
 * and retains shadowParts-derived content.
 */
export function serverMessageToComposerPrompt(message: OpenCodeServerMessage): ComposerPrompt {
	const attachments: CreateAttachment[] = [];
	for (const part of message.parts) {
		if (part.type === "file") {
			attachments.push(attachmentFromServerFilePart(part));
		}
	}
	return { text: serverMessageText(message), attachments };
}

/** Joined text parts of a server message — the text half of the composer prompt. */
export function serverMessageText(message: OpenCodeServerMessage): string {
	const texts: string[] = [];
	for (const part of message.parts) {
		if (part.type === "text") {
			texts.push(part.text ?? "");
		}
	}
	return texts.join("\n").trim();
}

export type RevertedUserRow = {
	id: string;
	text: string;
	additions: number;
	deletions: number;
	hasDiffs: boolean;
};

export function deriveRevertedUserRows(
	boundaryId: string | undefined,
	messageOrder: readonly string[] | undefined,
	messagesById: Record<string, OpenCodeServerMessage> | undefined,
): RevertedUserRow[] {
	if (boundaryId === undefined) return [];
	const order = messageOrder ?? [];
	const boundaryIndex = order.indexOf(boundaryId);
	if (boundaryIndex === -1) return [];
	const rows: RevertedUserRow[] = [];
	for (let i = boundaryIndex; i < order.length; i++) {
		const id = order[i];
		if (id === undefined) continue;
		const message = messagesById?.[id];
		if (message?.info?.role !== "user") continue;
		const diffs = message.info.summary?.diffs ?? [];
		rows.push({
			id,
			text: serverMessageText(message),
			additions: diffs.reduce((total: number, diff) => total + diff.additions, 0),
			deletions: diffs.reduce((total: number, diff) => total + diff.deletions, 0),
			hasDiffs: diffs.length > 0,
		});
	}
	return rows;
}

/**
 * Row model for the pending revert's expanded message list: one row per
 * reverted user message at or after the boundary, determined by position in
 * `messageOrder` (not by string comparison). The three `useAuiState` calls
 * subscribe only to stable references (primitive boundary id, the
 * `messageOrder` array and `messagesById` object — both replaced only on
 * session/history updates, never on streaming deltas); the row model itself
 * is memoized on them so `Object.is` comparisons hold.
 */
export const useRevertedUserRows = (): RevertedUserRow[] => {
	const boundaryId = useRevertBoundaryId();
	const messageOrder = useAuiState(
		(s) => selectOpenCodeExtras(s.thread.extras)?.state.messageOrder,
	);
	const messagesById = useAuiState(
		(s) => selectOpenCodeExtras(s.thread.extras)?.state.messagesById,
	);
	return deriveRevertedUserRows(boundaryId, messageOrder, messagesById);
};

/**
 * Whether this message is strictly after the pending revert boundary in
 * `messageOrder`. Uses index comparison instead of string comparison so it
 * works correctly with non-monotonic ids (e.g. random nanoids from
 * `useLocalRuntime`). Returns false when there is no pending revert.
 */
export const useIsAfterPendingBoundary = (pendingId: string | null): boolean =>
	useAuiState((s) => {
		if (pendingId === null) return false;
		const order = selectOpenCodeExtras(s.thread.extras)?.state.messageOrder;
		if (!order) return false;
		const pendingIndex = order.indexOf(pendingId);
		const messageIndex = order.indexOf(s.message.id);
		return pendingIndex !== -1 && messageIndex > pendingIndex;
	});

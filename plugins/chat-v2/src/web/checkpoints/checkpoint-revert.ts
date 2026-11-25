import { type useAui, useAuiState, type ThreadMessage } from "@assistant-ui/react";
import type { CreateAttachment } from "@assistant-ui/core";
import {
	userFileUrl,
	type FileDiffInfo,
	type OpenCodeServerMessage,
	type SessionMessageUser,
} from "@kilo-desktop/react-opencode-v2";

import { selectOpenCodeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import { userPromptText } from "./retry-failed-prompt";

export type AuiClient = ReturnType<typeof useAui>;

/** Primitive subscription — subscribing to the extras object would re-render every action bar on each streaming delta. */
export const useHasOpenCodeExtras = (): boolean =>
	useAuiState((s) => selectOpenCodeExtras(s.thread.extras) != null);

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
 * The pending revert's file changes (`session.revert.files`) by reference —
 * safe for `Object.is` because the session is replaced only when it changes,
 * never on streaming deltas. Callers filter/sum during render; deriving here
 * would re-render on every store update.
 */
export const useRevertDiffs = (): readonly FileDiffInfo[] | undefined =>
	useAuiState((s) => selectOpenCodeExtras(s.thread.extras)?.session?.revert?.files);

/**
 * Whether any user turn at or after this message changed files (its steps'
 * `snapshot.files`). Gates RevertToHereButton so ranges without recorded
 * workspace changes keep the button hidden. Boolean primitive — safe for
 * `Object.is`.
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
	let userIndex = -1;
	state.messageOrder.forEach((messageId, index) => {
		indexById.set(messageId, index);
		const message = state.messagesById[messageId];
		if (message?.type === "user") userIndex = index;
		else if (message?.type === "assistant" && (message.snapshot?.files?.length ?? 0) > 0) {
			lastChangedUserIndex = userIndex;
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

export async function restoreToComposer(aui: AuiClient, prompt: ComposerPrompt): Promise<void> {
	const composer = aui.thread.composer();
	// Replace, not prepend: the reverted prompt becomes the new draft.
	composer.setText(prompt.text);

	const restoredIds = new Set(prompt.attachments.map(({ id }) => id).filter(Boolean));

	// Remove stale attachments whose id is absent from the restored prompt.
	// `clearAttachments()` is safe here because we re-add the restored set below.
	const hasStale = composer.getState().attachments.some(({ id }) => id && !restoredIds.has(id));
	if (hasStale) {
		// A failed clear must not block the revert.
		await composer.clearAttachments().catch(() => undefined);
	}

	const currentIds = new Set(composer.getState().attachments.map(({ id }) => id));
	for (const attachment of prompt.attachments) {
		// A failed attachment must not block the revert.
		if (attachment.id && currentIds.has(attachment.id)) continue;
		// Serial on purpose: the composer appends attachments, so this keeps the original order.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		await composer.addAttachment(attachment).catch(() => undefined);
	}
}

export function messageToComposerPrompt(message: ThreadMessage): ComposerPrompt {
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
		if (message?.type === "user") {
			next = message;
			break;
		}
	}
	if (next) {
		await extras.revert(next.id);
		await restoreToComposer(aui, serverMessageToComposerPrompt(next));
	} else {
		await extras.unrevert();
		// Full undo clears text only — attachments added by an earlier restore
		// stay in the composer (deliberate divergence: the extension's
		// `unrevertSession` clears the entire prompt input including all
		// attachment kinds; desktop keeps all attachments).
		aui.thread.composer().setText("");
	}
}

type UserFile = NonNullable<SessionMessageUser["files"]>[number];

// Mirrors the projection's attachments so restored attachments match how the
// original message rendered them.
export const attachmentFromUserFile = (file: UserFile, index: number): CreateAttachment => {
	const url = userFileUrl(file);
	const name = file.name ?? "file";
	if (file.mime.startsWith("image/")) {
		return {
			id: String(index),
			type: "image",
			name,
			contentType: file.mime,
			content: [{ type: "image", image: url }],
		};
	}
	return {
		id: String(index),
		type: "file",
		name,
		contentType: file.mime,
		content: [{ type: "file", data: url, mimeType: file.mime }],
	};
};

/** A prompt as the composer takes it back: its text and attached files. */
export function serverMessageToComposerPrompt(message: OpenCodeServerMessage): ComposerPrompt {
	if (message.type !== "user") return { text: "", attachments: [] };
	return {
		text: serverMessageText(message),
		attachments: (message.files ?? []).map(attachmentFromUserFile),
	};
}

/** A prompt's text — the text half of the composer prompt. */
export function serverMessageText(message: OpenCodeServerMessage): string {
	return message.type === "user" ? message.text.trim() : "";
}

export type RevertedUserRow = {
	id: string;
	text: string;
	additions: number;
	deletions: number;
	hasDiffs: boolean;
};

/** The files each prompt's turn changed (its steps' `snapshot.files`), by prompt id. */
function turnFiles(
	order: readonly string[],
	messagesById: Record<string, OpenCodeServerMessage> | undefined,
	from: number,
): Map<string, Set<string>> {
	const files = new Map<string, Set<string>>();
	let current: Set<string> | undefined;
	for (let i = from; i < order.length; i++) {
		const message = messagesById?.[order[i]!];
		if (message?.type === "user") {
			current = new Set();
			files.set(message.id, current);
		} else if (message?.type === "assistant") {
			for (const file of message.snapshot?.files ?? []) current?.add(file);
		}
	}
	return files;
}

export function deriveRevertedUserRows(
	boundaryId: string | undefined,
	messageOrder: readonly string[] | undefined,
	messagesById: Record<string, OpenCodeServerMessage> | undefined,
	revertFiles: readonly FileDiffInfo[] = [],
): RevertedUserRow[] {
	if (boundaryId === undefined) return [];
	const order = messageOrder ?? [];
	const boundaryIndex = order.indexOf(boundaryId);
	if (boundaryIndex === -1) return [];
	const changed = turnFiles(order, messagesById, boundaryIndex);
	const rows: RevertedUserRow[] = [];
	for (let i = boundaryIndex; i < order.length; i++) {
		const id = order[i];
		if (id === undefined) continue;
		const message = messagesById?.[id];
		if (message?.type !== "user") continue;
		const files = changed.get(id) ?? new Set<string>();
		// The revert reports each file's line counts; a turn counts the files it changed.
		const diffs = revertFiles.filter((diff) => files.has(diff.file));
		rows.push({
			id,
			text: serverMessageText(message),
			additions: diffs.reduce((total, diff) => total + diff.additions, 0),
			deletions: diffs.reduce((total, diff) => total + diff.deletions, 0),
			hasDiffs: files.size > 0,
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
	const revertFiles = useRevertDiffs();
	return deriveRevertedUserRows(boundaryId, messageOrder, messagesById, revertFiles);
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

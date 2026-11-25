import { type useAui, useAuiState, type ThreadMessage } from "@assistant-ui/react";
import type {
	SessionInfo,
	SessionMessageInfo,
	SessionMessageUser,
} from "@kilo-desktop/react-opencode";
import type { CreateAttachment } from "@assistant-ui/core";

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

type FileDiff = NonNullable<NonNullable<SessionInfo["revert"]>["files"]>[number];

/**
 * The staged revert's file changes (`session.revert.files`), by reference —
 * safe for `Object.is` because the runtime replaces `session.revert` only on
 * revert events, never on streaming deltas. Callers sum during render.
 */
export const useRevertDiffs = (): readonly FileDiff[] | undefined =>
	useAuiState((s) => selectOpenCodeExtras(s.thread.extras)?.session?.revert?.files);

/**
 * Whether any user turn at or after this message changed files. Gates
 * RevertToHereButton so ranges without workspace changes keep the button
 * hidden. Boolean primitive — safe for `Object.is`.
 */
export const useRevertRangeHasFileChanges = (): boolean =>
	useAuiState((s) => {
		const extras = selectOpenCodeExtras(s.thread.extras);
		if (!extras) return false;
		const { indexById, lastChangedUserIndex } = fileChangeIndex(extras.state.messages);
		const messageIndex = indexById.get(s.message.id);
		return messageIndex !== undefined && messageIndex <= lastChangedUserIndex;
	});

/** What a user turn changed on disk, summed over its edits' diffs. */
export interface TurnFileChanges {
	readonly changed: boolean;
	readonly additions: number;
	readonly deletions: number;
}

const NO_CHANGES: TurnFileChanges = { changed: false, additions: 0, deletions: 0 };

const FILE_WRITING_TOOLS = new Set(["edit", "write", "patch"]);

const isFileDiff = (value: unknown): value is FileDiff =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as FileDiff).additions === "number" &&
	typeof (value as FileDiff).deletions === "number";

/**
 * v2 keeps no per-prompt diff summary (v1's `summary.diffs`), so a turn's
 * changes are read from its steps: the completed `edit`/`write`/`patch`
 * calls, whose `metadata.files` (FileDiffInfo) carry the line counts. A
 * `write` reports no diff, so it marks the turn changed without adding lines.
 */
function turnFileChanges(
	messages: readonly SessionMessageInfo[],
	userIndex: number,
): TurnFileChanges {
	let changed = false;
	let additions = 0;
	let deletions = 0;
	for (let index = userIndex + 1; index < messages.length; index++) {
		const message = messages[index]!;
		if (message.type === "user") break;
		if (message.type !== "assistant") continue;
		for (const item of message.content) {
			if (item.type !== "tool" || item.state.status !== "completed") continue;
			if (!FILE_WRITING_TOOLS.has(item.name)) continue;
			changed = true;
			const files = item.state.metadata?.["files"];
			if (!Array.isArray(files)) continue;
			for (const diff of files) {
				if (!isFileDiff(diff)) continue;
				additions += diff.additions;
				deletions += diff.deletions;
			}
		}
	}
	return changed ? { changed, additions, deletions } : NO_CHANGES;
}

interface FileChangeIndex {
	readonly indexById: ReadonlyMap<string, number>;
	/** The last user message whose turn changed files; -1 when none did. */
	readonly lastChangedUserIndex: number;
	readonly changesByUserId: ReadonlyMap<string, TurnFileChanges>;
}

/*
 * Every user message asks this on every store update, so it is computed once
 * per transcript: scanning the rest of the thread per message made each
 * streamed token cost O(messages²).
 */
const fileChangeIndexes = new WeakMap<readonly SessionMessageInfo[], FileChangeIndex>();

function fileChangeIndex(messages: readonly SessionMessageInfo[]): FileChangeIndex {
	const cached = fileChangeIndexes.get(messages);
	if (cached) return cached;
	const indexById = new Map<string, number>();
	const changesByUserId = new Map<string, TurnFileChanges>();
	let lastChangedUserIndex = -1;
	messages.forEach((message, index) => {
		indexById.set(message.id, index);
		if (message.type !== "user") return;
		const changes = turnFileChanges(messages, index);
		changesByUserId.set(message.id, changes);
		if (changes.changed) lastChangedUserIndex = index;
	});
	const index = { indexById, lastChangedUserIndex, changesByUserId };
	fileChangeIndexes.set(messages, index);
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
	const { messages } = extras.state;
	const targetIndex = messages.findIndex((message) => message.id === targetId);
	if (targetIndex === -1) return;
	const next = messages
		.slice(targetIndex + 1)
		.find((message): message is SessionMessageUser => message.type === "user");
	if (next) {
		await extras.revert(next.id);
		await restoreToComposer(aui, userMessageToComposerPrompt(next));
	} else {
		await extras.unrevert();
		// Full undo clears text only — attachments added by an earlier restore
		// stay in the composer (deliberate divergence: the extension's
		// `unrevertSession` clears the entire prompt input including all
		// attachment kinds; desktop keeps all attachments).
		aui.thread.composer().setText("");
	}
}

type PromptFile = NonNullable<SessionMessageUser["files"]>[number];

/** A stored prompt file as the projection shows it: a data URL (inline files) or its URI. */
const promptFileUrl = (file: PromptFile): string =>
	file.source.type === "uri"
		? file.source.uri
		: file.data.startsWith("data:")
			? file.data
			: `data:${file.mime};base64,${file.data}`;

// Mirrors the projection's user attachments so restored ones match how the
// original message rendered them.
export const attachmentFromPromptFile = (file: PromptFile, id: string): CreateAttachment => {
	const url = promptFileUrl(file);
	const name = file.name ?? "file";
	if (file.mime.startsWith("image/")) {
		return {
			id,
			type: "image",
			name,
			contentType: file.mime,
			content: [{ type: "image", image: url }],
		};
	}
	return {
		id,
		type: "file",
		name,
		contentType: file.mime,
		content: [{ type: "file", data: url, mimeType: file.mime }],
	};
};

/** A v2 user message's prompt (`text` and `files`) for the composer. */
export function userMessageToComposerPrompt(message: SessionMessageUser): ComposerPrompt {
	return {
		text: message.text.trim(),
		attachments: (message.files ?? []).map((file, index) =>
			attachmentFromPromptFile(file, `${message.id}:${index}`),
		),
	};
}

export type RevertedUserRow = {
	id: string;
	text: string;
	additions: number;
	deletions: number;
	hasDiffs: boolean;
};

/** One row per user message at or after the revert boundary, by transcript position. */
export function deriveRevertedUserRows(
	boundaryId: string | undefined,
	messages: readonly SessionMessageInfo[] | undefined,
): RevertedUserRow[] {
	if (boundaryId === undefined || !messages) return [];
	const boundaryIndex = messages.findIndex((message) => message.id === boundaryId);
	if (boundaryIndex === -1) return [];
	const { changesByUserId } = fileChangeIndex(messages);
	const rows: RevertedUserRow[] = [];
	for (const message of messages.slice(boundaryIndex)) {
		if (message.type !== "user") continue;
		const changes = changesByUserId.get(message.id) ?? NO_CHANGES;
		rows.push({
			id: message.id,
			text: message.text.trim(),
			additions: changes.additions,
			deletions: changes.deletions,
			hasDiffs: changes.changed,
		});
	}
	return rows;
}

/**
 * Row model for the pending revert's expanded message list. Subscribes to the
 * primitive boundary id and the transcript array (replaced only when a message
 * changes); the rows are derived during render.
 */
export const useRevertedUserRows = (): RevertedUserRow[] => {
	const boundaryId = useRevertBoundaryId();
	const messages = useAuiState((s) => selectOpenCodeExtras(s.thread.extras)?.state.messages);
	return deriveRevertedUserRows(boundaryId, messages);
};

/**
 * Whether this message is strictly after the pending revert boundary in the
 * transcript. Uses position, not id comparison, so it holds for any id
 * scheme. Returns false when there is no pending revert.
 */
export const useIsAfterPendingBoundary = (pendingId: string | null): boolean =>
	useAuiState((s) => {
		if (pendingId === null) return false;
		const messages = selectOpenCodeExtras(s.thread.extras)?.state.messages;
		if (!messages) return false;
		const { indexById } = fileChangeIndex(messages);
		const pendingIndex = indexById.get(pendingId);
		const messageIndex = indexById.get(s.message.id);
		return pendingIndex !== undefined && messageIndex !== undefined && messageIndex > pendingIndex;
	});

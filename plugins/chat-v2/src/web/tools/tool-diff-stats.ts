import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

import type { SessionMessageInfo } from "@kilo-desktop/react-opencode-v2";

import { findKiloToolCall, kiloToolUnifiedDiff } from "../runtime/kilo-transcript";
import type { ActivityPart } from "./tool-categories";
import { getPatchInfo, str } from "./tool-ui-shared";

/**
 * Pure diff-stat extraction for file-mutation tool calls (edit, write,
 * patch). Kept free of React and activity-row imports so activity-group
 * can aggregate counts on the group trigger without an import cycle.
 */

const FILE_PATH_KEYS = ["file_path", "filePath", "path", "file"] as const;

export const getToolFilePath = (args: Record<string, unknown> | undefined): string => {
	if (!args) return "";
	for (const key of FILE_PATH_KEYS) {
		const value = str(args[key]);
		if (value) return value;
	}
	return "";
};

/** The unified diff Kilo reports for a file tool call (its `metadata.files` patches), when it has one. */
export const getToolUnifiedDiff = (
	messages: readonly SessionMessageInfo[],
	toolCallId: string,
): string | undefined => kiloToolUnifiedDiff(findKiloToolCall(messages, toolCallId));

export type FileDiffStats = { added: number; removed: number };

/** Sum line-level additions/deletions across parsed file diffs. */
export const sumFileDiffStats = (fileDiffs: readonly FileDiffMetadata[]): FileDiffStats | null => {
	if (fileDiffs.length === 0) return null;
	let added = 0;
	let removed = 0;
	for (const fileDiff of fileDiffs) {
		for (const hunk of fileDiff.hunks) {
			added += hunk.additionLines;
			removed += hunk.deletionLines;
		}
	}
	return { added, removed };
};

const EDIT_OLD_KEYS = ["oldString", "old_string", "oldText", "old_text"] as const;
const EDIT_NEW_KEYS = ["newString", "new_string", "newText", "new_text"] as const;
const WRITE_CONTENT_KEYS = ["content", "contents"] as const;

const firstStringArg = (
	args: Record<string, unknown> | undefined,
	keys: readonly string[],
): string | undefined => {
	if (!args) return undefined;
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string") return value;
	}
	return undefined;
};

export const getEditOldString = (args: Record<string, unknown> | undefined): string =>
	firstStringArg(args, EDIT_OLD_KEYS) ?? "";

export const getEditNewString = (args: Record<string, unknown> | undefined): string =>
	firstStringArg(args, EDIT_NEW_KEYS) ?? "";

export const hasEditStringArgs = (args: Record<string, unknown> | undefined): boolean =>
	firstStringArg(args, EDIT_OLD_KEYS) !== undefined ||
	firstStringArg(args, EDIT_NEW_KEYS) !== undefined;

export const getWriteContent = (args: Record<string, unknown> | undefined): string => {
	if (!args) return "";
	for (const key of WRITE_CONTENT_KEYS) {
		const value = str(args[key]);
		if (value) return value;
	}
	return "";
};

const statsFromUnifiedDiff = (unifiedDiff: string): FileDiffStats | null => {
	try {
		return sumFileDiffStats(parsePatchFiles(unifiedDiff).flatMap((patch) => patch.files));
	} catch {
		return null;
	}
};

/**
 * Line-change stats for a single tool part; null for non-mutation tools.
 * Mirrors the row components: the backend unified diff wins when present,
 * patch counts its patch text directly, and in-flight calls are skipped
 * because streaming args would make the counts jitter.
 */
export const getPartDiffStats = (
	part: ActivityPart,
	messages: readonly SessionMessageInfo[],
): FileDiffStats | null => {
	if (part.type !== "tool-call" || !part.toolName) return null;
	if (part.status?.type === "running") return null;
	const toolName = part.toolName.toLowerCase();
	const args = (part.args ?? undefined) as Record<string, unknown> | undefined;

	if (toolName === "patch") {
		const patchText = str(args?.patchText);
		if (!patchText) return null;
		const { added, removed } = getPatchInfo(patchText);
		return added > 0 || removed > 0 ? { added, removed } : null;
	}

	const isEdit = toolName === "edit" || toolName === "notebook_edit";
	const isWrite = toolName === "write";
	if (!isEdit && !isWrite) return null;

	const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : "";
	const unifiedDiff = toolCallId ? getToolUnifiedDiff(messages, toolCallId) : undefined;
	if (unifiedDiff) return statsFromUnifiedDiff(unifiedDiff);

	if (isWrite) {
		const content = getWriteContent(args);
		if (!content) return null;
		return sumFileDiffStats([parseDiffFromFile(null, { name: "write", contents: content })]);
	}

	const oldString = firstStringArg(args, EDIT_OLD_KEYS);
	const newString = firstStringArg(args, EDIT_NEW_KEYS);
	if (oldString === undefined && newString === undefined) return null;
	return sumFileDiffStats([
		parseDiffFromFile(
			{ name: "edit", contents: oldString ?? "" },
			{ name: "edit", contents: newString ?? "" },
		),
	]);
};

/** Aggregate line-change stats across a tool group's file-mutation parts. */
export const getGroupDiffStats = (
	parts: readonly ActivityPart[],
	indices: readonly number[],
	messages: readonly SessionMessageInfo[],
): FileDiffStats | null => {
	let added = 0;
	let removed = 0;
	let found = false;
	for (const index of indices) {
		const part = parts[index];
		if (!part) continue;
		const stats = getPartDiffStats(part, messages);
		if (!stats) continue;
		found = true;
		added += stats.added;
		removed += stats.removed;
	}
	return found ? { added, removed } : null;
};

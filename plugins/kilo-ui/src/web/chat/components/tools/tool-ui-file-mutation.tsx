import { memo, useMemo } from "react";
import type { ToolCallMessagePartComponent, ToolCallMessagePartProps } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";

import {
	parseChatPatchFiles,
	PIERRE_DIFF_OPTIONS,
	withChatDiffCacheKey,
} from "../../pierre-diff.js";
import { usePrimePierreDiffs } from "../../use-prime-pierre-diffs.js";
import type { ActivitySubgroupContextValue } from "./activity-group.js";
import { SoloAwareExpandableRow } from "./tool-ui-activity-row.js";
import { basename, str } from "./tool-ui-shared.js";

const FILE_PATH_KEYS = ["file_path", "filePath", "path", "file"] as const;

export const getToolFilePath = (args: Record<string, unknown> | undefined): string => {
	if (!args) return "";
	for (const key of FILE_PATH_KEYS) {
		const value = str(args[key]);
		if (value) return value;
	}
	return "";
};

/** Prefer the backend unified diff when present on the OpenCode tool part. */
export const getToolUnifiedDiffFromParts = (
	parts: unknown,
	toolCallId: string,
): string | undefined => {
	if (!Array.isArray(parts)) return undefined;
	for (const part of parts) {
		if (!part || typeof part !== "object") continue;
		const record = part as Record<string, unknown>;
		if (record.type !== "tool") continue;
		const callId = record.callID ?? record.id;
		if (callId !== toolCallId) continue;
		const state = record.state;
		if (!state || typeof state !== "object") continue;
		const metadata = (state as Record<string, unknown>).metadata;
		if (!metadata || typeof metadata !== "object") continue;
		const diff = (metadata as Record<string, unknown>).diff;
		return typeof diff === "string" && diff.length > 0 ? diff : undefined;
	}
	return undefined;
};

export const PierreDiffBody = ({
	unifiedDiff,
	fileDiff,
}: {
	unifiedDiff?: string | undefined;
	fileDiff: FileDiffMetadata | null;
}) => {
	if (unifiedDiff) {
		return (
			<div className="overflow-hidden rounded-md border">
				<PatchDiff patch={unifiedDiff} options={PIERRE_DIFF_OPTIONS} />
			</div>
		);
	}

	if (fileDiff) {
		return (
			<div className="overflow-hidden rounded-md border">
				<FileDiff fileDiff={fileDiff} options={PIERRE_DIFF_OPTIONS} />
			</div>
		);
	}

	return null;
};

export type FileMutationDiffConfig = {
	subgroupKind: ActivitySubgroupContextValue["kind"];
	liveVerb: string;
	doneVerb: string;
	buildFallbackFileDiff: (input: {
		args: Record<string, unknown> | undefined;
		path: string;
		fileName: string;
	}) => FileDiffMetadata | null;
};

export const createFileMutationDiff = (
	config: FileMutationDiffConfig,
): ToolCallMessagePartComponent => {
	const Component: ToolCallMessagePartComponent = memo((props: ToolCallMessagePartProps) => {
		const { args, status, toolCallId } = props;

		const record = args as Record<string, unknown> | undefined;
		const path = getToolFilePath(record);
		const fileName = path ? basename(path) : "";

		const opencodeParts = useAuiState((s) => {
			const custom = s.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
			return custom?.opencode?.parts;
		});

		const unifiedDiff = useMemo(
			() => getToolUnifiedDiffFromParts(opencodeParts, toolCallId),
			[opencodeParts, toolCallId],
		);

		const fileDiff = useMemo(() => {
			if (unifiedDiff) {
				const parsedFiles = parseChatPatchFiles(unifiedDiff, toolCallId);
				return parsedFiles.length === 1 ? parsedFiles[0]! : null;
			}
			const fallback = config.buildFallbackFileDiff({ args: record, path, fileName });
			return fallback ? withChatDiffCacheKey(fallback, toolCallId) : null;
		}, [unifiedDiff, record, path, fileName, toolCallId]);
		const primedFileDiffs = useMemo(() => (fileDiff ? [fileDiff] : []), [fileDiff]);
		usePrimePierreDiffs(primedFileDiffs);

		const hasDiff = Boolean(unifiedDiff || fileDiff);

		return (
			<SoloAwareExpandableRow
				kind={config.subgroupKind}
				liveVerb={config.liveVerb}
				doneVerb={config.doneVerb}
				object={fileName || undefined}
				status={status}
				hasDetail={hasDiff}
				detail={
					<PierreDiffBody unifiedDiff={fileDiff ? undefined : unifiedDiff} fileDiff={fileDiff} />
				}
			/>
		);
	});

	return Component;
};

export { parseDiffFromFile };

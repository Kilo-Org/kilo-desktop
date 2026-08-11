import { memo, useMemo } from "react";
import type { ToolCallMessagePartComponent, ToolCallMessagePartProps } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";

import type { ActivitySubgroupContextValue } from "./activity-group.js";
import { SoloAwareExpandableRow } from "./tool-ui-activity-row.js";
import { basename, str } from "./tool-ui-shared.js";

export const PIERRE_DIFF_OPTIONS = {
	theme: { dark: "pierre-dark" as const, light: "pierre-light" as const },
	diffStyle: "unified" as const,
	overflow: "wrap" as const,
};

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
			if (unifiedDiff) return null;
			return config.buildFallbackFileDiff({ args: record, path, fileName });
		}, [unifiedDiff, record, path, fileName]);

		const hasDiff = Boolean(unifiedDiff || fileDiff);

		return (
			<SoloAwareExpandableRow
				kind={config.subgroupKind}
				liveVerb={config.liveVerb}
				doneVerb={config.doneVerb}
				object={fileName || undefined}
				status={status}
				hasDetail={hasDiff}
				detail={<PierreDiffBody unifiedDiff={unifiedDiff} fileDiff={fileDiff} />}
			/>
		);
	});

	return Component;
};

export { parseDiffFromFile };

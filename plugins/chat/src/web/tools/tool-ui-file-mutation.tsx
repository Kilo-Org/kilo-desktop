import { memo, useMemo } from "react";
import type { ToolCallMessagePartComponent, ToolCallMessagePartProps } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

import { parseChatPatchFiles, usePierreDiffOptions, withChatDiffCacheKey } from "./pierre-diff";
import { usePrimePierreDiffs } from "./use-prime-pierre-diffs";
import type { ActivitySubgroupContextValue } from "./activity-group";
import { SoloAwareExpandableRow } from "./tool-ui-activity-row";
import { getToolFilePath, getToolUnifiedDiffFromParts, sumFileDiffStats } from "./tool-diff-stats";
import { basename, DiffCounts } from "./tool-ui-shared";

export { getToolFilePath, getToolUnifiedDiffFromParts, sumFileDiffStats } from "./tool-diff-stats";
export type { FileDiffStats } from "./tool-diff-stats";

export const PierreDiffBody = ({
	unifiedDiff,
	fileDiff,
}: {
	unifiedDiff?: string | undefined;
	fileDiff: FileDiffMetadata | null;
}) => {
	const options = usePierreDiffOptions();
	const patchFileDiffs = useMemo(
		() => (unifiedDiff ? parsePatchFiles(unifiedDiff).flatMap((patch) => patch.files) : []),
		[unifiedDiff],
	);

	if (unifiedDiff) {
		if (patchFileDiffs.length === 0) return null;

		return (
			<div className="overflow-hidden rounded-md border">
				{patchFileDiffs.map((patchFileDiff, index) => (
					<FileDiff
						key={`${patchFileDiff.name}-${index}`}
						fileDiff={patchFileDiff}
						options={options}
					/>
				))}
			</div>
		);
	}

	if (fileDiff) {
		return (
			<div className="overflow-hidden rounded-md border">
				<FileDiff fileDiff={fileDiff} options={options} />
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

		const fileDiffs = useMemo(() => {
			if (unifiedDiff) return parseChatPatchFiles(unifiedDiff, toolCallId);
			const fallback = config.buildFallbackFileDiff({ args: record, path, fileName });
			return fallback ? [withChatDiffCacheKey(fallback, toolCallId)] : [];
		}, [unifiedDiff, record, path, fileName, toolCallId]);
		const fileDiff = fileDiffs.length === 1 ? fileDiffs[0]! : null;
		const primedFileDiffs = useMemo(() => (fileDiff ? [fileDiff] : []), [fileDiff]);
		usePrimePierreDiffs(primedFileDiffs);

		const diffStats = useMemo(() => sumFileDiffStats(fileDiffs), [fileDiffs]);
		const isRunning = status?.type === "running";
		const trailing = !isRunning && diffStats ? <DiffCounts {...diffStats} /> : null;

		const hasDiff = Boolean(unifiedDiff || fileDiff);

		return (
			<SoloAwareExpandableRow
				kind={config.subgroupKind}
				liveVerb={config.liveVerb}
				doneVerb={config.doneVerb}
				object={fileName || undefined}
				status={status}
				disclosureId={toolCallId}
				hasDetail={hasDiff}
				trailing={trailing}
				detail={
					<PierreDiffBody unifiedDiff={fileDiff ? undefined : unifiedDiff} fileDiff={fileDiff} />
				}
			/>
		);
	});

	return Component;
};

export { parseDiffFromFile };

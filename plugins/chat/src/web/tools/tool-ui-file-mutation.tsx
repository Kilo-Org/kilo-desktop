import { useAuiState } from "@assistant-ui/react";
import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

import { parseChatPatchFiles, usePierreDiffOptions, withChatDiffCacheKey } from "./pierre-diff";
import { usePrimePierreDiffs } from "./use-prime-pierre-diffs";
import type { ActivitySubgroupContextValue } from "./activity-group";
import { SoloAwareExpandableRow } from "./tool-ui-activity-row";
import { getToolFilePath, getToolUnifiedDiffFromParts, sumFileDiffStats } from "./tool-diff-stats";
import { basename, DiffCounts } from "./tool-ui-shared";
import type { ToolCallComponent, ToolCallView } from "./tool-call";

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
	const patchFileDiffs = unifiedDiff
		? parsePatchFiles(unifiedDiff).flatMap((patch) => patch.files)
		: [];

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

function fallbackFileDiffs(
	config: FileMutationDiffConfig,
	input: Parameters<FileMutationDiffConfig["buildFallbackFileDiff"]>[0],
	toolCallId: string,
): FileDiffMetadata[] {
	const fallback = config.buildFallbackFileDiff(input);
	return fallback ? [withChatDiffCacheKey(fallback, toolCallId)] : [];
}

function FileMutationDiff({
	config,
	args,
	status,
	toolCallId,
}: ToolCallView & { config: FileMutationDiffConfig }) {
	const unifiedDiff = useAuiState((s) => {
		const custom = s.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
		return getToolUnifiedDiffFromParts(custom?.opencode?.parts, toolCallId);
	});
	const record = args as Record<string, unknown> | undefined;
	const path = getToolFilePath(record);
	const fileName = path ? basename(path) : "";

	const fileDiffs = unifiedDiff
		? parseChatPatchFiles(unifiedDiff, toolCallId)
		: fallbackFileDiffs(config, { args: record, path, fileName }, toolCallId);
	const fileDiff = fileDiffs.length === 1 ? fileDiffs[0]! : null;
	const diffStats = sumFileDiffStats(fileDiffs);
	usePrimePierreDiffs(fileDiff ? [fileDiff] : []);

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
}

export const createFileMutationDiff =
	(config: FileMutationDiffConfig): ToolCallComponent =>
	(props) => <FileMutationDiff {...props} config={config} />;

export { parseDiffFromFile };

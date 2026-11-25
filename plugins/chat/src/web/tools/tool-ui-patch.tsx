import { useAuiState } from "@assistant-ui/react";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";

import { parseChatPatchFiles, usePierreDiffOptions } from "./pierre-diff";
import { usePrimePierreDiffs } from "./use-prime-pierre-diffs";
import { openCodeMessagesOf } from "./opencode-tool";
import { getToolUnifiedDiff, sumFileDiffStats } from "./tool-diff-stats";
import { SoloAwareExpandableRow } from "./tool-ui-activity-row";
import { basename, DiffCounts, getPatchInfo, str } from "./tool-ui-shared";
import type { ToolCallComponent } from "./tool-call";

interface PatchBlock {
	type: string;
	path: string;
	body: string;
}

function parseClaudePatchBlocks(patchText: string): PatchBlock[] {
	const cleaned = patchText
		.replace(/^\*\*\*\s*Begin Patch\s*$/gm, "")
		.replace(/^\*\*\*\s*End Patch\s*$/gm, "")
		.trim();

	const headerRegex = /^\*\*\*\s+(Update|Add|Delete)\s+File:\s+(.+)$/gm;
	const blocks: PatchBlock[] = [];
	let lastIndex = 0;
	for (const match of cleaned.matchAll(headerRegex)) {
		if (blocks.length > 0) {
			blocks[blocks.length - 1]!.body = cleaned.slice(lastIndex, match.index);
		}
		blocks.push({ type: match[1]!, path: match[2]!.trim(), body: "" });
		lastIndex = match.index + match[0].length;
	}
	if (blocks.length > 0) {
		blocks[blocks.length - 1]!.body = cleaned.slice(lastIndex);
	}

	return blocks;
}

function buildHunkHeader(
	lines: string[],
	oldStart: number,
	newStart: number,
): { header: string; oldCount: number; newCount: number } {
	let oldCount = 0;
	let newCount = 0;
	for (const line of lines) {
		if (line.startsWith("+")) newCount++;
		else if (line.startsWith("-")) oldCount++;
		else {
			oldCount++;
			newCount++;
		}
	}
	return {
		header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
		oldCount,
		newCount,
	};
}

function claudeBlockToUnifiedDiff(block: PatchBlock): string {
	const { type, path, body } = block;
	const bodyLines = body.split("\n").filter((l) => l.trim() !== "" || l.startsWith(" "));

	const diffLines: string[] = [];
	for (const line of bodyLines) {
		if (/^@@.*@@\s*$/.test(line)) continue;
		if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
			diffLines.push(line);
		}
	}

	let gitHeader: string;
	let fileHeader: string;
	switch (type) {
		case "Add":
			gitHeader = `diff --git a/${path} b/${path}\nnew file mode 100644`;
			fileHeader = `--- /dev/null\n+++ b/${path}`;
			break;
		case "Delete":
			gitHeader = `diff --git a/${path} b/${path}\ndeleted file mode 100644`;
			fileHeader = `--- a/${path}\n+++ /dev/null`;
			break;
		default:
			gitHeader = `diff --git a/${path} b/${path}`;
			fileHeader = `--- a/${path}\n+++ b/${path}`;
	}

	if (diffLines.length === 0) return `${gitHeader}\n${fileHeader}`;

	if (type === "Add") {
		const addLines = diffLines.map((l) => (l.startsWith("+") ? l : `+${l}`));
		const count = addLines.length;
		return `${gitHeader}\n${fileHeader}\n@@ -0,0 +1,${count} @@\n${addLines.join("\n")}`;
	}

	if (type === "Delete") {
		const delLines = diffLines.map((l) => (l.startsWith("-") ? l : `-${l}`));
		const count = delLines.length;
		return `${gitHeader}\n${fileHeader}\n@@ -1,${count} +0,0 @@\n${delLines.join("\n")}`;
	}

	const { header: hunkHeader } = buildHunkHeader(diffLines, 1, 1);
	return `${gitHeader}\n${fileHeader}\n${hunkHeader}\n${diffLines.join("\n")}`;
}

/**
 * The patch as a unified diff (the backend's file diffs once settled, else
 * the patch text converted), and its file diffs once it has finished, primed
 * for highlighting.
 */
function usePatchDiffs(patchText: string, isRunning: boolean, toolCallId: string) {
	const backendDiff = useAuiState((s) =>
		getToolUnifiedDiff(openCodeMessagesOf(s.message.metadata), toolCallId),
	);
	const unifiedPatch =
		backendDiff ??
		(patchText ? parseClaudePatchBlocks(patchText).map(claudeBlockToUnifiedDiff).join("\n") : "");
	const hasDiff = unifiedPatch.length > 0 && !isRunning;
	const fileDiffs = hasDiff ? parseChatPatchFiles(unifiedPatch, toolCallId) : [];
	usePrimePierreDiffs(fileDiffs);
	return { unifiedPatch, hasDiff, fileDiffs };
}

export const PatchToolDiff: ToolCallComponent = ({ args, status, toolCallId }) => {
	const options = usePierreDiffOptions();
	const isRunning = status?.type === "running";
	const { unifiedPatch, hasDiff, fileDiffs } = usePatchDiffs(
		str(args?.patchText),
		isRunning,
		toolCallId,
	);
	const patchInfo = getPatchInfo(str(args?.patchText));

	const object =
		patchInfo.files.length === 0
			? undefined
			: patchInfo.files.length === 1
				? patchInfo.files[0]
				: `${patchInfo.files.length} files`;

	const counts = sumFileDiffStats(fileDiffs) ?? {
		added: patchInfo.added,
		removed: patchInfo.removed,
	};
	const trailing = !isRunning ? <DiffCounts {...counts} /> : null;

	if (fileDiffs.length > 1) {
		return (
			<div className="flex flex-col gap-0.5">
				{fileDiffs.map((fileDiff) => (
					<SoloAwareExpandableRow
						key={fileDiff.cacheKey ?? fileDiff.name}
						kind="editing"
						liveVerb="Editing"
						doneVerb="Edited"
						object={basename(fileDiff.name)}
						status={status}
						disclosureId={`${toolCallId}:${fileDiff.cacheKey ?? fileDiff.name}`}
						hasDetail
						forceRow
						detail={
							<div className="overflow-hidden rounded-md border">
								<FileDiff fileDiff={fileDiff} options={options} />
							</div>
						}
					/>
				))}
			</div>
		);
	}

	return (
		<SoloAwareExpandableRow
			kind="editing"
			liveVerb="Editing"
			doneVerb="Edited"
			object={object}
			status={status}
			disclosureId={toolCallId}
			hasDetail={hasDiff}
			trailing={trailing}
			detail={
				<div className="overflow-hidden rounded-md border">
					{fileDiffs.length > 0 ? (
						fileDiffs.map((fileDiff) => (
							<FileDiff
								key={fileDiff.cacheKey ?? fileDiff.name}
								fileDiff={fileDiff}
								options={options}
							/>
						))
					) : (
						<PatchDiff patch={unifiedPatch} options={options} />
					)}
				</div>
			}
		/>
	);
};
PatchToolDiff.displayName = "PatchToolDiff";

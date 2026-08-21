import { memo, useMemo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { SoloAwareExpandableRow } from "./tool-ui-activity-row.js";
import { PierreDiffBody } from "./tool-ui-file-mutation.js";
import { getPatchInfo, str } from "./tool-ui-shared.js";

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

export const ApplyPatchDiff: ToolCallMessagePartComponent = memo(({ args, status }) => {
	const patchText = str(args?.patchText);

	const patchInfo = useMemo(() => getPatchInfo(patchText), [patchText]);

	const unifiedPatch = useMemo(() => {
		if (!patchText) return "";
		const blocks = parseClaudePatchBlocks(patchText);
		return blocks.map(claudeBlockToUnifiedDiff).join("\n");
	}, [patchText]);

	const isRunning = status?.type === "running";
	const hasDiff = unifiedPatch.length > 0 && !isRunning;

	const object =
		patchInfo.files.length === 0
			? undefined
			: patchInfo.files.length === 1
				? patchInfo.files[0]
				: `${patchInfo.files.length} files`;

	const trailing =
		(patchInfo.added > 0 || patchInfo.removed > 0) && !isRunning ? (
			<span className="ml-0.5 flex items-center gap-1 font-mono text-xs">
				{patchInfo.added > 0 ? <span className="text-green-500">+{patchInfo.added}</span> : null}
				{patchInfo.removed > 0 ? <span className="text-red-500">-{patchInfo.removed}</span> : null}
			</span>
		) : null;

	return (
		<SoloAwareExpandableRow
			kind="editing"
			liveVerb="Editing"
			doneVerb="Edited"
			object={object}
			status={status}
			hasDetail={hasDiff}
			trailing={trailing}
			detail={<PierreDiffBody unifiedDiff={unifiedPatch} fileDiff={null} />}
		/>
	);
});
ApplyPatchDiff.displayName = "ApplyPatchDiff";

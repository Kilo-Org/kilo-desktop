import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { useMemo } from "react";

import { useDiffTheme } from "./diff-theme";

const PIERRE_DIFF_OPTIONS = {
	diffStyle: "unified" as const,
	lineDiffType: "none" as const,
	overflow: "wrap" as const,
	unsafeCSS: `
		:host {
			--diffs-bg: var(--background);
			--diffs-font-size: 0.75rem;
			--diffs-line-height: 1.125rem;
			background-color: var(--background);
		}
	`,
};

export function usePierreDiffOptions() {
	const { mode, shiki } = useDiffTheme();
	return useMemo(() => ({ ...PIERRE_DIFF_OPTIONS, theme: shiki, themeType: mode }), [mode, shiki]);
}

const hashDiffSource = (source: string): string => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
};

const buildDiffCacheScope = (identity: string, source: string): string =>
	`kilo-chat:diff:${identity}:${source.length}:${hashDiffSource(source)}`;

export const parseChatPatchFiles = (patch: string, identity: string): FileDiffMetadata[] => {
	try {
		return parsePatchFiles(patch, buildDiffCacheScope(identity, patch)).flatMap(
			(parsedPatch) => parsedPatch.files,
		);
	} catch {
		return [];
	}
};

export const withChatDiffCacheKey = (
	fileDiff: FileDiffMetadata,
	identity: string,
): FileDiffMetadata => {
	const source = [
		fileDiff.prevName ?? "",
		fileDiff.name,
		fileDiff.deletionLines.join("\u0001"),
		fileDiff.additionLines.join("\u0001"),
	].join("\u0000");
	return {
		...fileDiff,
		cacheKey: buildDiffCacheScope(identity, source),
	};
};

import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

export const PIERRE_DIFF_THEME = {
	dark: "pierre-dark" as const,
	light: "pierre-light" as const,
};

export const PIERRE_DIFF_OPTIONS = {
	theme: PIERRE_DIFF_THEME,
	diffStyle: "unified" as const,
	lineDiffType: "none" as const,
	overflow: "wrap" as const,
	unsafeCSS: `
		:host {
			--diffs-light-bg: var(--background);
			--diffs-dark-bg: var(--background);
		}
	`,
};

const hashDiffSource = (source: string): string => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
};

const buildDiffCacheScope = (identity: string, source: string): string =>
	`kilo-ui:chat-diff:${identity}:${source.length}:${hashDiffSource(source)}`;

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

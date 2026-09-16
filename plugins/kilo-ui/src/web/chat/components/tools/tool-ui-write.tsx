import { createFileMutationDiff, parseDiffFromFile } from "./tool-ui-file-mutation.js";
import { getWriteContent } from "./tool-diff-stats.js";

export { getWriteContent } from "./tool-diff-stats.js";

export const WriteDiff = createFileMutationDiff({
	subgroupKind: "writing",
	liveVerb: "Writing",
	doneVerb: "Wrote",
	buildFallbackFileDiff: ({ args, path, fileName }) => {
		const content = getWriteContent(args);
		if (!path || !content) return null;
		return parseDiffFromFile(null, {
			name: fileName || path,
			contents: content,
		});
	},
});
WriteDiff.displayName = "WriteDiff";

import { createFileMutationDiff, parseDiffFromFile } from "./tool-ui-file-mutation.js";
import { str } from "./tool-ui-shared.js";

const CONTENT_KEYS = ["content", "contents"] as const;

export const getWriteContent = (args: Record<string, unknown> | undefined): string => {
	if (!args) return "";
	for (const key of CONTENT_KEYS) {
		const value = str(args[key]);
		if (value) return value;
	}
	return "";
};

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

import { createFileMutationDiff, parseDiffFromFile } from "./tool-ui-file-mutation";
import { getEditNewString, getEditOldString, hasEditStringArgs } from "./tool-diff-stats";

export const EditDiff = createFileMutationDiff({
	subgroupKind: "editing",
	liveVerb: "Editing",
	doneVerb: "Edited",
	buildFallbackFileDiff: ({ args, path, fileName }) => {
		const oldString = getEditOldString(args);
		const newString = getEditNewString(args);
		if (!path || !hasEditStringArgs(args)) return null;
		const name = fileName || path;
		return parseDiffFromFile({ name, contents: oldString }, { name, contents: newString });
	},
});
EditDiff.displayName = "EditDiff";

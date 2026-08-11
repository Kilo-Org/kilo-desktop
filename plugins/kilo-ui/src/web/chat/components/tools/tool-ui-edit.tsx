import { createFileMutationDiff, parseDiffFromFile } from "./tool-ui-file-mutation.js";

const OLD_KEYS = ["oldString", "old_string", "oldText", "old_text"] as const;
const NEW_KEYS = ["newString", "new_string", "newText", "new_text"] as const;

const firstStringArg = (
	args: Record<string, unknown> | undefined,
	keys: readonly string[],
): string | undefined => {
	if (!args) return undefined;
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string") return value;
	}
	return undefined;
};

export const getEditOldString = (args: Record<string, unknown> | undefined): string =>
	firstStringArg(args, OLD_KEYS) ?? "";

export const getEditNewString = (args: Record<string, unknown> | undefined): string =>
	firstStringArg(args, NEW_KEYS) ?? "";

export const EditDiff = createFileMutationDiff({
	subgroupKind: "editing",
	liveVerb: "Editing",
	doneVerb: "Edited",
	buildFallbackFileDiff: ({ args, path, fileName }) => {
		const oldString = firstStringArg(args, OLD_KEYS);
		const newString = firstStringArg(args, NEW_KEYS);
		if (!path || (oldString === undefined && newString === undefined)) return null;
		const name = fileName || path;
		return parseDiffFromFile(
			{ name, contents: oldString ?? "" },
			{ name, contents: newString ?? "" },
		);
	},
});
EditDiff.displayName = "EditDiff";

import { supersedeEntry } from "./log";
import type { Insert } from "./types";

/**
 * The change log: every handoff, newest first, in a log's format. The handoff
 * fills it; agents only supersede an entry that's wrong.
 */
export const changeLog: Insert = {
	supersede: supersedeEntry,
	refusals: {
		add: "The change log is filled by hand_off.",
		remove: "Change log entries are never removed: supersede it instead.",
		setStatus: "Change log entries have no status.",
		write: "The change log is filled by hand_off.",
	},
};

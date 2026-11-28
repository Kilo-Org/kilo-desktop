import type { SectionTypeDefinition } from "../../contracts";
import { supersedeEntry } from "./log";

/** The change log: every handoff, newest first, in a log's format. hand_off fills it. */
export const changeLog: SectionTypeDefinition = {
	single: true,
	title: "Change Log",
	collects: "Every handoff, newest first.",
	usage: "Filled by hand_off; don't add to it directly.",
	supersede: supersedeEntry,
	refusals: {
		add: "The change log is filled by hand_off.",
		remove: "Change log entries are never removed: supersede it instead.",
		setStatus: "Change log entries have no status.",
		write: "The change log is filled by hand_off.",
	},
};

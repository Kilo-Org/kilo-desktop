import type { SectionTypeDefinition } from "../../contracts";
import { activity } from "./activity";
import { changeLog } from "./change-log";
import { goal } from "./goal";
import { handoff } from "./handoff";
import { log } from "./log";
import { notes } from "./notes";
import { output } from "./output";
import { plan } from "./plan";
import { questions } from "./questions";
import { todo } from "./todo";

/**
 * The section types kilo.workbooks ships, by `section-type` contribution id
 * (which is each type's id). One file per type, so each can change on its
 * own; they use only what kilo.workbooks' contracts offer any contributor.
 */
export const BUILT_IN_SECTION_TYPES: Readonly<Record<string, SectionTypeDefinition>> = {
	goal,
	plan,
	handoff,
	activity,
	"change-log": changeLog,
	todo,
	log,
	questions,
	notes,
	output,
};

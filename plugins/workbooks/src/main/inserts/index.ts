import type { SectionType } from "../../contracts";
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
import type { Insert } from "./types";

/**
 * Each insert's implementation, by its id in the catalogue
 * (contracts/templates.ts `SECTION_CATALOGUE`). One file per insert, so each can change
 * on its own.
 */
export const INSERT_IMPLEMENTATIONS: Readonly<Record<SectionType, Insert>> = {
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

export type {
	Insert,
	InsertContext,
	NewItem,
	Renumbering,
	StatusChange,
	StepStatus,
} from "./types";

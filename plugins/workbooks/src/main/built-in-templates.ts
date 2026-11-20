import blankManifest from "../../templates/blank/workbook.json";
import blankGuide from "../../templates/blank/AGENTS.md?raw";
import blankBrief from "../../templates/blank/pages/brief.md?raw";
import blankNotes from "../../templates/blank/pages/notes.md?raw";
import codingManifest from "../../templates/coding/workbook.json";
import codingGuide from "../../templates/coding/AGENTS.md?raw";
import codingBrief from "../../templates/coding/pages/brief.md?raw";
import codingRecord from "../../templates/coding/pages/decisions-and-findings.md?raw";
import codingPlan from "../../templates/coding/pages/plan.md?raw";
import { templateFromFiles } from "./template-files";

/** The templates kilo.workbooks ships, by `template` contribution id. */
export const BUILT_IN_TEMPLATES = {
	coding: () =>
		templateFromFiles(codingManifest, {
			"AGENTS.md": codingGuide,
			"pages/brief.md": codingBrief,
			"pages/decisions-and-findings.md": codingRecord,
			"pages/plan.md": codingPlan,
		}),
	blank: () =>
		templateFromFiles(blankManifest, {
			"AGENTS.md": blankGuide,
			"pages/brief.md": blankBrief,
			"pages/notes.md": blankNotes,
		}),
} as const;

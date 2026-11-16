import codingManifest from "../../templates/coding/workbook.json";
import codingGuide from "../../templates/coding/AGENTS.md?raw";
import codingArtifacts from "../../templates/coding/pages/artifacts.md?raw";
import codingBrief from "../../templates/coding/pages/brief.md?raw";
import codingDecisions from "../../templates/coding/pages/decisions.md?raw";
import codingFindings from "../../templates/coding/pages/findings.md?raw";
import codingFollowUps from "../../templates/coding/pages/follow-ups.md?raw";
import codingNotes from "../../templates/coding/pages/notes.md?raw";
import codingPlan from "../../templates/coding/pages/plan.md?raw";
import codingQuestions from "../../templates/coding/pages/questions.md?raw";
import codingReview from "../../templates/coding/pages/review.md?raw";
import codingSnippets from "../../templates/coding/pages/snippets.md?raw";
import codingTasks from "../../templates/coding/pages/tasks.md?raw";
import { templateFromFiles } from "./template-files";

/** The templates kilo.workbooks ships, by `template` contribution id. */
export const BUILT_IN_TEMPLATES = {
	coding: () =>
		templateFromFiles(codingManifest, {
			"AGENTS.md": codingGuide,
			"pages/artifacts.md": codingArtifacts,
			"pages/brief.md": codingBrief,
			"pages/decisions.md": codingDecisions,
			"pages/findings.md": codingFindings,
			"pages/follow-ups.md": codingFollowUps,
			"pages/notes.md": codingNotes,
			"pages/plan.md": codingPlan,
			"pages/questions.md": codingQuestions,
			"pages/review.md": codingReview,
			"pages/snippets.md": codingSnippets,
			"pages/tasks.md": codingTasks,
		}),
} as const;

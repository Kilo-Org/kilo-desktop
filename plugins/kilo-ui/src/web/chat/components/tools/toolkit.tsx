import { defineToolkit } from "@assistant-ui/react";

import {
	ApplyPatchTool,
	AskQuestionTool,
	BashTool,
	EditTool,
	GlobTool,
	GrepTool,
	PlanExitToolUI,
	ReadTool,
	SkillTool,
	TaskTool,
	TaskListTool,
	WebFetchTool,
	WebSearchTool,
	WriteTool,
} from "./opencode-tools.js";

const askQuestionTool = {
	type: "backend" as const,
	render: AskQuestionTool,
};

/**
 * Render-only toolkit for Kilo/OpenCode backend tools. Execution stays on the
 * server; assistant-ui only supplies per-tool UI. Avoid `externalTool()` —
 * that marker requires the `"use generative"` compiler, which this package
 * does not run.
 */
export default defineToolkit({
	read: { type: "backend", render: ReadTool },
	edit: { type: "backend", render: EditTool },
	write: { type: "backend", render: WriteTool },
	bash: { type: "backend", render: BashTool },
	grep: { type: "backend", render: GrepTool },
	glob: { type: "backend", render: GlobTool },
	list: { type: "backend", render: GlobTool },
	codebase_search: { type: "backend", render: GrepTool },
	semantic_search: { type: "backend", render: GrepTool },
	webSearch: { type: "backend", render: WebSearchTool },
	websearch: { type: "backend", render: WebSearchTool },
	webFetch: { type: "backend", render: WebFetchTool },
	webfetch: { type: "backend", render: WebFetchTool },
	apply_patch: { type: "backend", render: ApplyPatchTool },
	plan_exit: { type: "backend", render: PlanExitToolUI, display: "standalone" },
	question: askQuestionTool,
	ask_question: askQuestionTool,
	request_user_input: askQuestionTool,
	requestUserInput: askQuestionTool,
	skill: { type: "backend", render: SkillTool },
	task: { type: "backend", render: TaskTool },
	todowrite: { type: "backend", render: TaskListTool },
	todoread: { type: "backend", render: TaskListTool },
});

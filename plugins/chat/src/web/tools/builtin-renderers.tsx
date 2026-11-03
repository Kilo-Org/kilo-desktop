import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memo, type ComponentType } from "react";

import type { ToolRendererImplementation, ToolRendererProps } from "../../contracts";
import { HtmlRenderToolUI } from "../html-render/HtmlRenderToolUI";
import { PlanAware, PlanExitTool } from "./plan-aware";
import { ApplyPatchDiff } from "./tool-ui-apply-patch";
import { BashTerminal } from "./tool-ui-bash";
import { EditDiff } from "./tool-ui-edit";
import { GlobActivity, GrepActivity, ReadActivity } from "./tool-ui-read-search";
import { SkillActivity } from "./tool-ui-skill";
import { TaskActivity } from "./tool-ui-task";
import { WebFetchActivity, WebSearchActivity } from "./tool-ui-web";
import { WriteDiff } from "./tool-ui-write";

/** A tool-call component as a renderer that ignores `Original`. */
function renders(Component: ToolCallMessagePartComponent): ToolRendererImplementation {
	const Rendered: ComponentType<ToolRendererProps> = ({ Original: _original, ...props }) => (
		<Component {...props} />
	);
	Rendered.displayName = Component.displayName ?? Component.name;
	return { component: memo(Rendered) };
}

/**
 * Question calls show as an "Asking" activity row; the questionnaire replaces
 * the composer while one is pending, so the call itself draws nothing.
 * Task-list calls are projected into the composer's task list.
 */
const NOTHING: ToolRendererImplementation = { component: () => null };

/**
 * kilo.chat's own `kilo.chat/tool-renderer` contributions (keys as in
 * plugin.json): origin's renderers for Kilo's built-in tools and the
 * `html_render` page, and the plan card for `plan_exit`.
 */
export const BUILTIN_TOOL_RENDERERS: Readonly<Record<string, ToolRendererImplementation>> = {
	read: renders(ReadActivity),
	edit: renders(PlanAware(EditDiff)),
	write: renders(PlanAware(WriteDiff)),
	bash: renders(BashTerminal),
	search: renders(GrepActivity),
	glob: renders(GlobActivity),
	"web-search": renders(WebSearchActivity),
	"web-fetch": renders(WebFetchActivity),
	"apply-patch": renders(ApplyPatchDiff),
	skill: renders(SkillActivity),
	task: renders(TaskActivity),
	question: NOTHING,
	todo: NOTHING,
	"html-render": renders(HtmlRenderToolUI),
	"plan-exit": renders(PlanExitTool),
};

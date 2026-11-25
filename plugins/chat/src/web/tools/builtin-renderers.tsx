import type { ComponentType } from "react";

import type { ToolRendererImplementation, ToolRendererProps } from "../../contracts";
import { HtmlRenderToolUI } from "../html-render/HtmlRenderToolUI";
import { PlanAware, PlanExitTool } from "./plan-aware";
import { ShellTerminal } from "./tool-ui-shell";
import { EditDiff } from "./tool-ui-edit";
import { GlobActivity, GrepActivity, ReadActivity } from "./tool-ui-read-search";
import { SkillActivity } from "./tool-ui-skill";
import { SubagentActivity } from "./tool-ui-subagent";
import { WebFetchActivity, WebSearchActivity } from "./tool-ui-web";
import { WriteDiff } from "./tool-ui-write";
import { PatchToolDiff } from "./tool-ui-patch";
import type { ToolCallComponent } from "./tool-call";

/** A tool-call component as a renderer that ignores `Original`. */
function renders(Component: ToolCallComponent): ToolRendererImplementation {
	const Rendered: ComponentType<ToolRendererProps> = ({ Original: _original, ...props }) => (
		<Component {...props} />
	);
	Rendered.displayName = Component.displayName ?? Component.name;
	return { component: Rendered };
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
	bash: renders(ShellTerminal),
	search: renders(GrepActivity),
	glob: renders(GlobActivity),
	"web-search": renders(WebSearchActivity),
	"web-fetch": renders(WebFetchActivity),
	"apply-patch": renders(PatchToolDiff),
	skill: renders(SkillActivity),
	task: renders(SubagentActivity),
	question: NOTHING,
	todo: NOTHING,
	"html-render": renders(HtmlRenderToolUI),
	"plan-exit": renders(PlanExitTool),
};

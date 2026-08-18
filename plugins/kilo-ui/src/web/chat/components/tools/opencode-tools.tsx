import { memo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { ApplyPatchDiff } from "./tool-ui-apply-patch.js";
import { BashTerminal } from "./tool-ui-bash.js";
import { EditDiff } from "./tool-ui-edit.js";
import { ToolCallFallback } from "./tool-ui-inline.js";
import { GlobActivity, GrepActivity, ReadActivity } from "./tool-ui-read-search.js";
import { SkillActivity } from "./tool-ui-skill.js";
import { WebFetchActivity, WebSearchActivity } from "./tool-ui-web.js";
import { WriteDiff } from "./tool-ui-write.js";
import { PlanAwareToolUI, PlanExitTool } from "../../plan/PlanAwareToolUI.js";

export const ReadTool = ReadActivity;
export const EditTool = PlanAwareToolUI(EditDiff);
export const WriteTool = PlanAwareToolUI(WriteDiff);
export const BashTool = BashTerminal;
export const GrepTool = GrepActivity;
export const GlobTool = GlobActivity;
export const WebSearchTool = WebSearchActivity;
export const WebFetchTool = WebFetchActivity;
export const ApplyPatchTool = ApplyPatchDiff;
export const PlanExitToolUI = PlanExitTool;
export const SkillTool = SkillActivity;
export const FallbackTool = ToolCallFallback;

/**
 * Question tools surface as an activity subgroup ("Asking" / "Asked …").
 * The Questionnaire replaces the composer while pending — no tool-call chrome.
 */
export const AskQuestionTool: ToolCallMessagePartComponent = memo(() => null);
AskQuestionTool.displayName = "AskQuestionTool";

/**
 * Suggestions surface as an activity subgroup plus the composer SuggestBar.
 * The picker lives outside the tool-call chrome.
 */
export const SuggestTool: ToolCallMessagePartComponent = memo(() => null);
SuggestTool.displayName = "SuggestTool";

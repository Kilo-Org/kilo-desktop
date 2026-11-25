import { SoloAwareLabelRow } from "./tool-ui-activity-row";
import { str, truncate } from "./tool-ui-shared";
import type { ToolCallComponent } from "./tool-call";

export const SkillActivity: ToolCallComponent = ({ args, status }) => {
	const name = str((args as Record<string, unknown> | undefined)?.id);
	const skill = name ? truncate(name) : undefined;

	return (
		<SoloAwareLabelRow
			kind="skill"
			liveVerb="Reading Skill"
			doneVerb="Read Skill"
			object={skill}
			status={status}
		/>
	);
};
SkillActivity.displayName = "SkillActivity";

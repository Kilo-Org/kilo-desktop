import { memo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { SoloAwareLabelRow } from "./tool-ui-activity-row";
import { str, truncate } from "./tool-ui-shared";

export const SkillActivity: ToolCallMessagePartComponent = memo(({ args, status }) => {
	const name = str((args as Record<string, unknown> | undefined)?.name);
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
});
SkillActivity.displayName = "SkillActivity";

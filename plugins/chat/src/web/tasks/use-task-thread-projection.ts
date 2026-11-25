import { useOpenCodeThreadState } from "@kilo-desktop/react-opencode";

import { projectTaskThread } from "./task-projection";

export function useTaskThreadProjection() {
	return useOpenCodeThreadState(projectTaskThread);
}

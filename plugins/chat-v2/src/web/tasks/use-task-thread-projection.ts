import { useOpenCodeThreadState } from "@kilo-desktop/react-opencode-v2";

import { projectTaskThread } from "./task-projection";

export function useTaskThreadProjection() {
	return useOpenCodeThreadState(projectTaskThread);
}

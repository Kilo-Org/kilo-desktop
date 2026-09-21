import { createContext, useContext, type ReactNode } from "react";

const WorktreeSetupContext = createContext(false);

export function WorktreeSetupProvider({
	isSettingUp,
	children,
}: {
	isSettingUp: boolean;
	children: ReactNode;
}) {
	return (
		<WorktreeSetupContext.Provider value={isSettingUp}>{children}</WorktreeSetupContext.Provider>
	);
}

export function useIsSettingUpWorktree(): boolean {
	return useContext(WorktreeSetupContext);
}

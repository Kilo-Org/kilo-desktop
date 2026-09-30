import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";

interface WorktreeSetupState {
	readonly isSettingUp: boolean;
	readonly isAwaitingSession: boolean;
}

const WorktreeSetupContext = createContext<WorktreeSetupState>({
	isSettingUp: false,
	isAwaitingSession: false,
});

/**
 * `isSettingUp` covers worktree creation plus session creation (the setup
 * indicator). `isAwaitingSession` stays set after that until the next
 * session preparation, so a thread still waiting for its `remoteId` keeps
 * reading as worktree-backed instead of briefly falling back to the
 * workspace checkout.
 */
export function WorktreeSetupProvider({
	isSettingUp,
	isAwaitingSession = false,
	children,
}: {
	isSettingUp: boolean;
	isAwaitingSession?: boolean;
	children: ReactNode;
}) {
	const value = useMemo(
		() => ({ isSettingUp, isAwaitingSession: isSettingUp || isAwaitingSession }),
		[isSettingUp, isAwaitingSession],
	);
	return <WorktreeSetupContext.Provider value={value}>{children}</WorktreeSetupContext.Provider>;
}

export function useIsSettingUpWorktree(): boolean {
	return useContext(WorktreeSetupContext).isSettingUp;
}

/**
 * True while the current thread's session is not created yet but will run
 * in a worktree that is still being set up — its working directory and
 * branch are unknown until the session exists.
 */
export function useIsThreadAwaitingWorktree(): boolean {
	const { isAwaitingSession } = useContext(WorktreeSetupContext);
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	return isAwaitingSession && remoteId === undefined;
}

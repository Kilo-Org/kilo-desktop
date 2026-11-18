/**
 * The hidden note a fresh fork is handed, so its next turn knows the copied
 * context was kept on purpose and the person may steer it elsewhere.
 *
 * The wording mirrors VS Code's `packages/kilo-vscode/src/agent-manager/fork-handoff.ts`
 * (the source of truth, also mirrored by JetBrains' `ForkHandoff.kt`). Desktop
 * always knows the fork's directory, so the directory lines are unconditional.
 */
export function forkHandoffText(directory: string): string {
	return [
		"<system-reminder>",
		"This session was forked from an existing session in the current repository or worktree.",
		`Use this as the current working directory: ${directory}`,
		"For this fork, this location supersedes any earlier repository or worktree location retained in the copied context.",
		"The prior conversation context was retained intentionally.",
		"The user may continue the same task, explore an alternative approach, or provide new instructions.",
		"Follow the user's next instruction as the direction for this fork, using retained context when relevant.",
		"</system-reminder>",
	].join("\n");
}

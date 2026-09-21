import { GitBranchIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";

import type { GitServiceContract } from "../contracts/schemas.js";
import { getReadOnlyBranchLabel, type SelectorQueryState } from "./branch-selector-state.js";
import { InitializeGitButton } from "./InitializeGitButton.js";

export interface GitBranchLabelProps {
	readonly workingDirectory?: string | undefined;
}

/**
 * Read-only current-branch label for the active-thread composer rail
 * (`kilo-ui/chat-composer-footer`). Probes the session's effective working
 * directory — the worktree when worktree-backed — so the label shows the
 * worktree branch, not the main checkout. Same workspace probes as the
 * draft footer switcher; hidden until a branch name is known — except
 * for a workspace the probe reports as `missing`, which swaps the label
 * slot for the shared Initialize Git action, muted to match the usage
 * metrics beside it. A successful init invalidates `repositoryType`, and
 * the refetch (now `regular`) renders the label here instead.
 */
export function GitBranchLabel({ workingDirectory }: GitBranchLabelProps) {
	const sdk = useSdk<GitServiceContract>("git");
	const typeQuery = useQuery({
		...sdkQueryOptions(sdk, "repositoryType", { workingDirectory: workingDirectory ?? "" }),
		enabled: workingDirectory !== undefined,
	});
	const isRegular = typeQuery.data?.kind === "regular";
	const query = useQuery({
		...sdkQueryOptions(sdk, "branches", { workingDirectory: workingDirectory ?? "" }),
		enabled: workingDirectory !== undefined && isRegular,
	});

	const state: SelectorQueryState = {
		workspaceDirectory: workingDirectory,
		isChecking: workingDirectory !== undefined && typeQuery.isPending,
		isRegular,
		typeFailed: typeQuery.isError,
		branchesPending: isRegular && query.isPending,
		branchesFailed: isRegular && query.isError,
		data: query.data,
	};
	const label = getReadOnlyBranchLabel(state);
	// The missing-repo swap must precede the null return: `label` is
	// undefined for a missing workspace (the branches probe never runs).
	// For a missing repo no worktree can exist, so the worktree-effective
	// directory equals the workspace directory.
	if (workingDirectory !== undefined && typeQuery.data?.kind === "missing") {
		return (
			<InitializeGitButton
				className="text-foreground/70 [&_svg]:text-foreground/40"
				workspaceDirectory={workingDirectory}
				size="sm"
				testId="git-init-thread-button"
			/>
		);
	}
	if (!label) return null;

	return (
		<span
			data-qa-id="git-branch-label"
			aria-label={`Branch ${label}`}
			title={label}
			className="text-foreground/70 flex h-7 min-w-0 items-center gap-1.5 text-xs"
		>
			<GitBranchIcon className="text-foreground/40 size-3 shrink-0" aria-hidden />
			<span className="truncate">{label}</span>
		</span>
	);
}

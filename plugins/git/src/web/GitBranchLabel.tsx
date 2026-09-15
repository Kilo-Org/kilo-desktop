import { GitBranchIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { sdkQueryOptions, useSdk } from "@anaconda-agentic-desktop/sdk-react";

import type { GitServiceContract } from "../contracts/schemas.js";
import { getReadOnlyBranchLabel, type SelectorQueryState } from "./branch-selector-state.js";

export interface GitBranchLabelProps {
	readonly workspaceDirectory?: string | undefined;
}

/**
 * Read-only current-branch label for the active-thread composer rail
 * (`kilo-ui/chat-composer-footer`). Same workspace probes as the draft
 * footer switcher; hidden until a branch name is known.
 */
export function GitBranchLabel({ workspaceDirectory }: GitBranchLabelProps) {
	const sdk = useSdk<GitServiceContract>("git");
	const typeQuery = useQuery({
		...sdkQueryOptions(sdk, "repositoryType", { workingDirectory: workspaceDirectory ?? "" }),
		enabled: workspaceDirectory !== undefined,
	});
	const isRegular = typeQuery.data?.kind === "regular";
	const query = useQuery({
		...sdkQueryOptions(sdk, "branches", { workingDirectory: workspaceDirectory ?? "" }),
		enabled: workspaceDirectory !== undefined && isRegular,
	});

	const state: SelectorQueryState = {
		workspaceDirectory,
		isChecking: workspaceDirectory !== undefined && typeQuery.isPending,
		isRegular,
		typeFailed: typeQuery.isError,
		branchesPending: isRegular && query.isPending,
		branchesFailed: isRegular && query.isError,
		data: query.data,
	};
	const label = getReadOnlyBranchLabel(state);
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

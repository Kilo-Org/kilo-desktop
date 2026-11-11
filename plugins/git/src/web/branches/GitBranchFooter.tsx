import { useQuery } from "@tanstack/react-query";
import { GitBranchIcon } from "lucide-react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import type { ComposerContext } from "@kilo-desktop/plugin-chat/contracts";

import { Repository } from "../../contracts";
import { branchesQuery, repositoryTypeQuery } from "../shared/repository-queries";
import { InitializeGitButton } from "./InitializeGitButton";

type Probe =
	| { readonly kind: "missing" }
	| { readonly kind: "branch"; readonly branch: string }
	| { readonly kind: "other" };

/**
 * What the footer shows for a directory: its repository's branch ("Detached
 * HEAD" without one), or that there is no repository. Read from the window's
 * repository cache, which the repository watcher refreshes when HEAD or the
 * refs change (a checkout anywhere), a worktree's branch is renamed, `init`
 * runs or the window regains focus.
 */
function useBranchProbe(directory: string): Probe | null {
	const repository = useDomainObject(Repository);
	const type = useQuery(repositoryTypeQuery(repository, directory));
	const regular = type.data?.kind === "regular";
	const branches = useQuery({
		...branchesQuery(repository, directory),
		enabled: repository !== null && regular,
	});
	if (type.isError) return { kind: "other" };
	if (!type.data) return null;
	if (type.data.kind === "missing") return { kind: "missing" };
	if (!regular || branches.isError) return { kind: "other" };
	if (branches.data === undefined) return null;
	if (!branches.data) return { kind: "other" };
	return { kind: "branch", branch: branches.data.currentBranch ?? "Detached HEAD" };
}

function BranchLabel({ directory }: { directory: string }) {
	const probe = useBranchProbe(directory);
	if (!probe) return null;
	if (probe.kind === "missing") {
		return (
			<InitializeGitButton
				directory={directory}
				qaId="git-init-thread-button"
				className="text-foreground/70"
			/>
		);
	}
	if (probe.kind !== "branch") return null;
	return (
		<span
			data-qa-id="git-branch-label"
			aria-label={`Branch ${probe.branch}`}
			title={probe.branch}
			className="text-foreground/70 flex h-7 min-w-0 items-center gap-1.5 text-xs"
		>
			<GitBranchIcon className="text-foreground/40 size-3 shrink-0" aria-hidden />
			<span className="truncate">{probe.branch}</span>
		</span>
	);
}

/**
 * The branch of the folder a chat works in (its worktree when it has one),
 * under the composer; "Initialize Git" when the folder is not a repository.
 * Hidden until the branch is known. Rendered over the window's repository
 * cache (`withRepositoryQueries`).
 */
export function GitBranchFooter({ directory }: ComposerContext) {
	if (!directory) return null;
	return <BranchLabel directory={directory} />;
}

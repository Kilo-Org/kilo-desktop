import type { PluginSdk } from "@kilo-desktop/kernel";
import { ComposerAction } from "@kilo-desktop/plugin-chat/contracts";
import { NewWorkSessionOption } from "@kilo-desktop/plugin-work-sessions/contracts";

import type { GitWindow } from "../shared/git-window";
import { withRepositoryQueries } from "../shared/repository-queries";
import { GitBranchFooter } from "./GitBranchFooter";
import { GitBranchSelector } from "./GitBranchSelector";
import { GitInitOption } from "./GitInitOption";

/**
 * The branch under a chat's composer, and on the New Session page the branch
 * picker and Initialize Git for a folder that is not a repository.
 */
export function activateBranches(sdk: PluginSdk, { queries }: GitWindow): void {
	sdk.extensions.implement(ComposerAction, "branch", {
		kind: "view",
		Component: withRepositoryQueries(queries, GitBranchFooter),
	});
	sdk.extensions.implement(
		NewWorkSessionOption,
		"branch",
		withRepositoryQueries(queries, GitBranchSelector),
	);
	sdk.extensions.implement(
		NewWorkSessionOption,
		"init",
		withRepositoryQueries(queries, GitInitOption),
	);
}

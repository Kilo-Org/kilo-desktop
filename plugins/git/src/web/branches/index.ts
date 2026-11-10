import type { PluginSdk } from "@kilo-desktop/kernel";
import { ComposerAction } from "@kilo-desktop/plugin-chat/contracts";
import { NewWorkSessionOption } from "@kilo-desktop/plugin-work-sessions/contracts";

import type { GitWindow } from "../shared/git-window";
import { withRepositoryQueries } from "../shared/repository-queries";
import { GitBranchFooter } from "./GitBranchFooter";
import { GitBranchSelector } from "./GitBranchSelector";

/** The branch under a chat's composer and the New Session page's branch picker. */
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
}

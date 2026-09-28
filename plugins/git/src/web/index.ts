import type { SDK } from "@kilo-desktop/feature-sdk";

import { registerDraftSelectionStore } from "./draft-selection-store.js";
import { registerGitWebMcpTools } from "./git-webmcp-tools.js";

export { GitBranchLabel } from "./GitBranchLabel.js";
export { GitBranchSelector } from "./GitBranchSelector.js";
export { GitDiffView } from "./GitDiffView.js";
export { GitDiffTabIcon } from "./GitDiffTabIcon.js";
export { GitRepositoryWatcherProvider } from "./GitRepositoryWatcherProvider.js";
export { GitDraftMenus } from "./GitDraftMenus.js";
export { GitEventsProvider } from "./GitEventsProvider.js";
export { GitActionsControl } from "./GitActionsControl.js";
export { GitSessionRowMetadata } from "./GitSessionRowMetadata.js";
export { GitSessionDetailsBranch, GitSessionDetailsPullRequest } from "./GitSessionDetails.js";
export { GitPrStatusProvider } from "./GitPrStatusProvider.js";
export { GitPrStatusTargets } from "./GitPrStatusTargets.js";

/**
 * Renderer boot hook (discovered from this web entry module by the feature
 * system). Runs before any zone component mounts, in both Electron and
 * browser modes, and failures are isolated per feature by the boot loop —
 * so `setSelection` can safely assume the store exists past this point.
 */
export function webRegister(sdk: SDK): void {
	registerDraftSelectionStore(sdk);
	registerGitWebMcpTools(sdk);
}

import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useWorkspaceWatcher } from "@kilo-desktop/sdk-react";

/**
 * App-lifetime watcher that keeps the composer footer's git UI in sync
 * with repository state changed from outside the app (a terminal
 * `git init`, a clone, or `.git` being deleted). The core workspace
 * watcher already watches every workspace folder — its default
 * excludes drop only `.git/objects/**` and `.git/subtree-cache/**` — so
 * `.git` events flow; this provider is the renderer's single subscriber
 * for them (the app-wide-dedup pattern: never subscribe per-component).
 *
 * The subscription filters to `.git` paths and accepts every event type so
 * existing metadata changes (for example HEAD, refs, and the index) also
 * invalidate cached repository state. A matching batch invalidates the
 * `repositoryType`,
 * `branches`, and `status` queries (`[featureId, channel]` prefix match,
 * the same trio as the `init` mutation's invalidation pass) so every
 * gated UI refetches and the footer swaps happen on their own. No
 * debounce: parcel coalesces native events and react-query dedupes
 * in-flight refetches; over-invalidation is intentional and cheap (a
 * still-missing directory re-runs one `git rev-parse`).
 *
 * Both include globs are needed (see the `useWorkspaceWatcher` call): the
 * contents glob alone misses the `.git` path event itself, and the
 * directory glob also matches the `.git` *file* of worktrees/submodules.
 */
export function GitRepositoryWatcherProvider({ children }: { readonly children: ReactNode }) {
	const queryClient = useQueryClient();

	useWorkspaceWatcher({
		includes: ["**/.git", "**/.git/**"],
		onFileChange: () => {
			for (const channel of ["repositoryType", "branches", "status"] as const) {
				void queryClient.invalidateQueries({ queryKey: ["git", channel] });
			}
		},
	});

	return children;
}

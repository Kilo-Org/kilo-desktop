import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { ComposerMention, MarkdownExtension } from "@kilo-desktop/plugin-chat/contracts";
import { PaneKind, Panes, WorkSessionsWindow } from "@kilo-desktop/plugin-work-sessions/contracts";

import { Documents, FILES_PANE_KIND } from "../contracts/index.js";
import { CloseGuards } from "./close-guards.js";
import { createFilesQueryClient } from "./documents.js";
import { FilesTabIcon } from "./file-icons/FilesTabIcon.js";
import { FilesPane, withFilesRuntime, type FilesRuntime } from "./FilesPane.js";
import { refetchOnWindowFocus } from "./focus-refetch.js";
import { createFilesMarkdownExtension } from "./markdown/FilesMarkdownExtension.js";
import { createFileMentionSource } from "./mentions/file-mention-source.js";

/**
 * kilo.files' renderer entry: the Files pane kind (explorer and file panes,
 * with a close guard for unsaved edits) and Open Files (⌘⇧E, shown or opened
 * through kilo.work-sessions' window), `@` file mentions in the composer and file links
 * in the agent's replies. The window keeps one cache of
 * kilo.files reads for them.
 */
export const filesWebEntry = definePlugin({
	activate(sdk) {
		const runtime: FilesRuntime = { queries: createFilesQueryClient(), guards: new CloseGuards() };
		sdk.onDispose(() => runtime.queries.clear());
		sdk.onDispose(refetchOnWindowFocus(runtime.queries));

		sdk.extensions.implement(PaneKind, "files", {
			component: withFilesRuntime(runtime, FilesPane),
			icon: FilesTabIcon,
			canClose: runtime.guards.canClose,
		});
		sdk.extensions.implement(KernelCommand, "open", () =>
			sdk.domainObjects.get(WorkSessionsWindow)?.methods.openPane({ kind: FILES_PANE_KIND }),
		);
		sdk.extensions.implement(
			ComposerMention,
			"files",
			createFileMentionSource(runtime.queries, () => sdk.domainObjects.get(Documents)),
		);
		sdk.extensions.implement(
			MarkdownExtension,
			"file-links",
			createFilesMarkdownExtension({
				queries: runtime.queries,
				documents: () => sdk.domainObjects.get(Documents),
				panes: () => sdk.domainObjects.get(Panes),
			}),
		);
	},
});

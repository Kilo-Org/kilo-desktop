import { useCallback, useState } from "react";

import { useDomain } from "@kilo-desktop/kernel/web";
import { PaneOpener, Panes } from "@kilo-desktop/plugin-sessions/contracts";
import { Files } from "@kilo-desktop/plugin-workspaces/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { HtmlPages } from "../../contracts";
import { useOptionalExtensions } from "../optional-extensions";
import { useChatMarkdownContext } from "../thread/chat-markdown";
import { injectHtmlRenderBootstrap } from "./html-render-bootstrap";
import { useHtmlRenderTheme } from "./HtmlRenderFrame";

export interface SaveHtmlPage {
	readonly save: (page: { readonly title: string; readonly html: string }) => Promise<void>;
	readonly saving: boolean;
}

const joinPath = (directory: string, name: string) =>
	`${directory.replace(/[\\/]+$/, "")}${directory.includes("\\") ? "\\" : "/"}${name}`;

/**
 * Saves a page as an `.html` file in the chat's primary workspace folder,
 * themed as it looks now so it reads the same opened on its own, and offers
 * to open it in a pane when a plugin opens workspace files. `undefined` when
 * the chat has no workspace folder to save into.
 */
export function useSaveHtmlPage(): SaveHtmlPage | undefined {
	const pages = useDomain(HtmlPages);
	const panes = useDomain(Panes);
	const fileOpeners = useOptionalExtensions(PaneOpener).filter(
		(opener) => opener.metadata.match.type === Files.id,
	);
	const chat = useChatMarkdownContext();
	const theme = useHtmlRenderTheme();
	const [saving, setSaving] = useState(false);
	const workspaceDirectory = chat?.workspaceFolders.find((folder) => folder.isPrimary)?.path;
	const sessionId = chat?.sessionId;
	const canOpen = panes !== null && fileOpeners.length > 0;

	const save = useCallback(
		async ({ title, html }: { readonly title: string; readonly html: string }) => {
			if (!workspaceDirectory || !sessionId || !pages) return;
			setSaving(true);
			try {
				const { relativePath } = await pages.methods.save({
					workspaceDirectory,
					title,
					html: injectHtmlRenderBootstrap(html, theme, { standalone: true }),
				});
				toast.success(`Saved ${relativePath}`, {
					description: workspaceDirectory,
					...(canOpen
						? {
								action: {
									label: "Open",
									onClick: () =>
										void panes?.methods
											.openObject({
												sessionId,
												ref: { type: Files.id, id: joinPath(workspaceDirectory, relativePath) },
											})
											.catch(() => undefined),
								},
							}
						: {}),
				});
			} catch (error) {
				toast.error("Couldn't save the page", {
					description: error instanceof Error ? error.message : undefined,
				});
			} finally {
				setSaving(false);
			}
		},
		[canOpen, pages, panes, sessionId, theme, workspaceDirectory],
	);

	return workspaceDirectory && sessionId && pages ? { save, saving } : undefined;
}

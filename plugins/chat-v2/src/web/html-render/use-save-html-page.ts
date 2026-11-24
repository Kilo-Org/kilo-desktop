import { useState } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { FileObjectType, Opener, Panes } from "@kilo-desktop/plugin-work-sessions/contracts";
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

async function savePageToWorkspace({
	pages,
	panes,
	workspaceDirectory,
	workSessionId,
	title,
	html,
}: {
	readonly pages: DomainObjectHandle<typeof HtmlPages>;
	/** Offers to open the saved file when set. */
	readonly panes: DomainObjectHandle<typeof Panes> | null;
	readonly workspaceDirectory: string;
	readonly workSessionId: string;
	readonly title: string;
	readonly html: string;
}): Promise<void> {
	try {
		const { relativePath } = await pages.methods.save({ workspaceDirectory, title, html });
		toast.success(`Saved ${relativePath}`, {
			description: workspaceDirectory,
			...(panes
				? {
						action: {
							label: "Open",
							onClick: () =>
								void panes.methods
									.openObject({
										workSessionId,
										ref: {
											type: FileObjectType.id,
											id: joinPath(workspaceDirectory, relativePath),
										},
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
	}
}

/**
 * Saves a page as an `.html` file in the chat's primary workspace folder,
 * themed as it looks now so it reads the same opened on its own, and offers
 * to open it in a pane when a plugin opens workspace files. `undefined` when
 * the chat has no workspace folder to save into.
 */
export function useSaveHtmlPage(): SaveHtmlPage | undefined {
	const pages = useDomainObject(HtmlPages);
	const panes = useDomainObject(Panes);
	const fileOpeners = useOptionalExtensions(Opener).filter(
		(opener) => opener.metadata.match.type === FileObjectType.id,
	);
	const chat = useChatMarkdownContext();
	const theme = useHtmlRenderTheme();
	const [saving, setSaving] = useState(false);
	const workspaceDirectory = chat?.workspaceFolders.find((folder) => folder.isPrimary)?.path;
	const workSessionId = chat?.workSessionId;
	const canOpen = panes !== null && fileOpeners.length > 0;

	const save = async ({ title, html }: { readonly title: string; readonly html: string }) => {
		if (!workspaceDirectory || !workSessionId || !pages) return;
		setSaving(true);
		await savePageToWorkspace({
			pages,
			panes: canOpen ? panes : null,
			workspaceDirectory,
			workSessionId,
			title,
			html: injectHtmlRenderBootstrap(html, theme, { standalone: true }),
		}).finally(() => setSaving(false));
	};

	return workspaceDirectory && workSessionId && pages ? { save, saving } : undefined;
}

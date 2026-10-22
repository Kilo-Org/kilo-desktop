import { useCallback, useState } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { toast } from "@kilo-desktop/ui/components/sonner";

import type { KiloUiChatService } from "../../../contracts/chat/schemas.js";
import { useChatMarkdownContext } from "../ChatMarkdownContext.js";
import { injectHtmlRenderBootstrap } from "./html-render-bootstrap.js";
import { useHtmlRenderTheme } from "./HtmlRenderFrame.js";

/**
 * The files plugin's viewer, declared locally (no import across features). It
 * renders an HTML file in a Browser tab when one is available.
 */
type FilesCapabilities = {
	readonly fileViewer?: {
		openFile(options: {
			readonly sessionId: string;
			readonly workspaceDirectory: string;
			readonly relativePath: string;
		}): void;
	};
};

export interface SaveHtmlPage {
	readonly save: (page: { readonly title: string; readonly html: string }) => Promise<void>;
	readonly saving: boolean;
}

/**
 * Saves a page as an `.html` file in the chat's working folder (its worktree
 * when it has one), themed as it looks now so it reads the same opened on its
 * own. `undefined` when the chat has no workspace folder to save into.
 */
export function useSaveHtmlPage(): SaveHtmlPage | undefined {
	const sdk = useSdk<KiloUiChatService>("kilo-ui");
	const chat = useChatMarkdownContext();
	const theme = useHtmlRenderTheme();
	const [saving, setSaving] = useState(false);
	const workspaceDirectory = chat?.workspaceFolders.find((folder) => folder.isPrimary)?.path;
	const sessionId = chat?.sessionId;

	const save = useCallback(
		async ({ title, html }: { readonly title: string; readonly html: string }) => {
			if (!workspaceDirectory || !sessionId) return;
			setSaving(true);
			try {
				const { relativePath } = await sdk.client["chat.saveHtmlPage"]({
					workspaceDirectory,
					title,
					html: injectHtmlRenderBootstrap(html, theme, { standalone: true }),
				});
				const fileViewer = sdk.plugins.get<FilesCapabilities>("files")?.fileViewer;
				toast.success(`Saved ${relativePath}`, {
					description: workspaceDirectory,
					...(fileViewer
						? {
								action: {
									label: "Open",
									onClick: () =>
										fileViewer.openFile({ sessionId, workspaceDirectory, relativePath }),
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
		[sdk, sessionId, theme, workspaceDirectory],
	);

	return workspaceDirectory && sessionId ? { save, saving } : undefined;
}

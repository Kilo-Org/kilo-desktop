import type { PluginSdk } from "@kilo-desktop/kernel";
import { ChatConfigPoint } from "@kilo-desktop/plugin-core/contracts";

import { SessionWorkbooks } from "../contracts";

export interface WorkbookChatConfigDeps {
	readonly instructions: (workbookId: string) => Promise<string>;
}

/**
 * Gives every chat in a work session on a workbook that workbook's
 * instructions (`kilo.core/chat-config`): its Brief and guide. Chats ask on
 * every send, so each chat reads Pages once, on its first send, and keeps
 * that copy (the agent reads the latest with `read_workbook`); a session
 * moved to another workbook reads again. Pages failing never fails a send:
 * the instructions then point at the Brief and guide instead.
 */
export function implementWorkbookChatConfig(sdk: PluginSdk, deps: WorkbookChatConfigDeps): void {
	const byChat = new Map<string, { workbookId: string; text: Promise<string> }>();
	sdk.extensions.implement(ChatConfigPoint, "workbook", {
		configure: async ({ chatId, workSessionId }) => {
			// Asked without a chat while one is created, for its permissions only.
			if (!chatId || !workSessionId) return {};
			const workbookId = sdk.domainObjects.get(SessionWorkbooks)?.lookup(workSessionId);
			if (typeof workbookId !== "string") return {};
			let cached = byChat.get(chatId);
			if (cached?.workbookId !== workbookId) {
				cached = { workbookId, text: deps.instructions(workbookId) };
				byChat.set(chatId, cached);
			}
			try {
				return { instructions: [await cached.text] };
			} catch (error) {
				byChat.delete(chatId);
				sdk.logger.warn(`Couldn't give a chat its workbook's instructions: ${String(error)}`);
				return {};
			}
		},
	});
}

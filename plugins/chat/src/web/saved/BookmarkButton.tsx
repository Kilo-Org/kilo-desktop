import { useAuiState, type AssistantState } from "@assistant-ui/react";
import { BookmarkIcon } from "lucide-react";
import type { FC } from "react";

import { useKernel } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { CHAT_BOOKMARK_SOURCE } from "./saved-anchor";
import { useChatSavedItems, useSavedLayer } from "./saved-layer";

/** Scans from the end, so the cost per state change stays a step or two. */
function isLastReply(state: AssistantState): boolean {
	const { messages } = state.thread;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]!.role === "assistant") return messages[index]!.id === state.message.id;
	}
	return false;
}

/**
 * Bookmarks the whole chat from the last reply's action row (between copy
 * and more); older replies don't offer it. Action rows hide while the agent
 * works, so the icon reappears under a new reply once it finishes. A chat
 * has one bookmark, and clicking the filled icon removes it.
 */
export const BookmarkButton: FC = () => {
	const lastReply = useAuiState(isLastReply);
	const layer = useSavedLayer();
	const kernel = useKernel();
	const items = useChatSavedItems(layer?.chatId ?? null);
	const bookmark = items.find((item) => item.source === CHAT_BOOKMARK_SOURCE);
	if (!layer || !lastReply) return null;
	const { saved, showToast } = layer;
	const label = bookmark ? "Remove bookmark" : "Bookmark chat";

	const toggle = async () => {
		if (bookmark) {
			const removed = await saved.remove(bookmark, "bookmark-button");
			if (removed) {
				showToast({
					message: "Removed from Saved",
					onUndo: () => {
						saved.reading.track("saved-toast-action", { action: "undo", kind: "chat" });
						void saved.restore(removed);
					},
				});
			}
			return;
		}
		const item = await saved.bookmark({ workSessionId: layer.workSessionId, chatId: layer.chatId });
		if (!item) return;
		showToast({
			message: "Added to Saved",
			onView: () => {
				saved.reading.track("saved-toast-action", { action: "view", kind: "chat" });
				void saved.viewSaved((command, args) => kernel.commands.execute(command, args));
			},
			onUndo: () => {
				saved.reading.track("saved-toast-action", { action: "undo", kind: "chat" });
				void saved.remove(item, "undo");
			},
		});
	};

	return (
		<Tooltip disableHoverablePopup>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						aria-label={label}
						aria-pressed={Boolean(bookmark)}
						data-qa-id="chat-message-bookmark"
						className="aui-button-icon size-6 p-1 active:scale-90"
						onClick={() => void toggle()}
					/>
				}
			>
				<BookmarkIcon className={cn("size-3.5", bookmark && "fill-current")} />
			</TooltipTrigger>
			<TooltipContent side="bottom" className="pointer-events-none">
				{label}
			</TooltipContent>
		</Tooltip>
	);
};

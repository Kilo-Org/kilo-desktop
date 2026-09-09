import { ChevronDownIcon, FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { useRef } from "react";

import { useAui } from "@assistant-ui/react";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { ButtonGroup } from "@anaconda-agentic-desktop/ui/components/button-group";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";

import { navigateToChat } from "../chat/chat-navigation.js";
import {
	DRAFT_RIGHT_PANEL_SESSION_KEY,
	useRightPanelStore,
} from "../chat/right-panel/right-panel-store.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";

export function GlobalNewButton() {
	const aui = useAui();
	const sdk = useSdk("kilo-ui");
	const { openCreate } = useWorkspacesFeature();
	const groupRef = useRef<HTMLDivElement>(null);

	const createChat = () => {
		useRightPanelStore.getState().clearSession(DRAFT_RIGHT_PANEL_SESSION_KEY);
		void aui.threads.switchToNewThread();
		navigateToChat(sdk);
	};

	return (
		<ButtonGroup ref={groupRef} className="w-full" aria-label="New">
			<Button
				type="button"
				aria-label="New"
				data-slot="aui_thread-list-new"
				data-qa-id="global-new"
				variant="outline"
				className="flex-1 justify-start font-normal"
				onClick={createChat}
			>
				<PlusIcon data-icon="inline-start" data-slot="aui_thread-list-new-icon" />
				<span data-slot="aui_thread-list-new-label">New</span>
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							type="button"
							aria-label="More new options"
							data-qa-id="global-new-menu"
							variant="outline"
							size="icon"
						/>
					}
				>
					<ChevronDownIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					anchor={groupRef}
					align="start"
					side="right"
					sideOffset={6}
					className="w-max min-w-0"
				>
					<DropdownMenuGroup>
						<DropdownMenuItem data-qa-id="global-new-chat" onClick={createChat}>
							<MessageSquareIcon />
							Chat
						</DropdownMenuItem>
						<DropdownMenuItem data-qa-id="global-new-workspace" onClick={openCreate}>
							<FolderIcon />
							Workspace
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</ButtonGroup>
	);
}

import {
	clear,
	click,
	expectElementToBeDisabled,
	expectElementToBeEnabled,
	expectElementToBeVisible,
	expectElementToHaveText,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { openNewChatDraft } from "./new-chat-draft.js";

export class ChatComposerPage {
	private readonly draftFooter = () => getLocatorByTestId("kilo-composer-draft-footer");
	private readonly workspaceSelector = () =>
		getLocatorByRole("combobox", { name: "Select workspace" });
	private readonly unscopedOption = () => getLocatorByTestId("workspace-unscoped-command");
	private readonly messageInput = () => getLocatorByRole("textbox", { name: "Message input" });
	// The send control swaps ids on connection state (kilo-composer-send vs
	// kilo-composer-send-when-connected), so match both.
	private readonly sendButton = () => getLocatorByTestId(/^kilo-composer-send(-when-connected)?$/);

	async openDraft(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/plugins/chat";
		});
		await openNewChatDraft();
		// `openNewChatDraft` reuses the current draft when the footer is already
		// visible, so a draft left over from a prior test keeps its typed text.
		// Start from an empty composer so the send-button state is deterministic.
		await this.clearMessage();
	}

	async clearMessage(): Promise<void> {
		await clear(this.messageInput());
	}

	async openWorkspaceSelector(): Promise<void> {
		await click(this.workspaceSelector());
	}

	async selectUnscopedWorkspace(): Promise<void> {
		await click(this.unscopedOption());
	}

	async typeMessage(text: string): Promise<void> {
		await fill(this.messageInput(), text);
	}

	async verifyDraftFooterVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.draftFooter(),
			"Draft footer should render for a new chat with no messages",
		);
	}

	async verifyWorkspaceSelectorVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceSelector(),
			"Draft footer should show the 'Select workspace' combobox",
		);
	}

	async verifyUnscopedOptionVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.unscopedOption(),
			"Workspace selector should offer the 'No workspace' option",
		);
	}

	async verifyWorkspaceSelectorLabel(text: string): Promise<void> {
		await expectElementToHaveText(this.workspaceSelector(), text, {
			message: `Workspace selector should read "${text}"`,
		});
	}

	async verifySendDisabled(): Promise<void> {
		// The send control is only rendered once the connection settles, so wait
		// for it to be visible before asserting its disabled state.
		await expectElementToBeVisible(
			this.sendButton(),
			"Send control should be present on an empty composer",
		);
		await expectElementToBeDisabled(
			this.sendButton(),
			"Send control should be disabled while the composer is empty",
		);
	}

	async verifySendEnabled(): Promise<void> {
		await expectElementToBeEnabled(
			this.sendButton(),
			"Send control should be enabled once the composer has a message",
		);
	}
}

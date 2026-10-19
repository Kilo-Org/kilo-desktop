import {
	clear,
	expectElementToBeVisible,
	expectElementToHaveText,
	getLocatorByRole,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { openNewChatDraft } from "./new-chat-draft.js";

/**
 * The welcome screen the user lands on when Kilo opens with no active
 * session: welcome logo + headline, composer, and the draft footer. Owns the
 * visible copy/labels so the spec reads as plain assertions.
 */
export class ChatWelcomePage {
	private readonly welcomeLogo = () => getLocatorByTestId("kilo-welcome-logo");
	// The screen also renders a "Search" dialog heading, so scope the welcome
	// headline by its level to avoid a strict-mode collision.
	private readonly headline = () => getLocatorByRole("heading", { level: 1 });
	private readonly messageInput = () => getLocatorByRole("textbox", { name: "Message input" });
	private readonly composerPlaceholder = () =>
		getLocatorByText("Send a message, @ to mention files, or / for commands…");
	private readonly addAttachment = () => getLocatorByRole("button", { name: "Add attachment" });
	private readonly agentSelector = () => getLocatorByRole("button", { name: "Select agent" });
	private readonly modelSelector = () => getLocatorByTestId("kilo-model-selector-trigger");
	private readonly approvalSelector = () => getLocatorByTestId("kilo-approval-selector-trigger");
	private readonly sendButton = () => getLocatorByTestId(/^kilo-composer-send(-when-connected)?$/);
	private readonly draftFooter = () => getLocatorByTestId("kilo-composer-draft-footer");
	private readonly workspaceSelector = () =>
		getLocatorByRole("combobox", { name: "Select workspace" });

	async openWelcome(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/plugins/chat";
		});
		await openNewChatDraft();
		await clear(this.messageInput());
	}

	async verifyWelcomeLogoVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.welcomeLogo(),
			"Welcome screen should show the Kilo logo above the headline",
		);
	}

	async verifyHeadlineText(text: string): Promise<void> {
		await expectElementToHaveText(this.headline(), text, {
			message: `Welcome headline should read "${text}"`,
		});
	}

	async verifyMessageInputVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.messageInput(),
			"Composer should show the 'Message input' textbox",
		);
	}

	async verifyComposerPlaceholderVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.composerPlaceholder(),
			"Composer should show the 'Send a message…' placeholder",
		);
	}

	async verifyAddAttachmentVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.addAttachment(),
			"Composer toolbar should show the 'Add attachment' button",
		);
	}

	async verifyAgentSelectorVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.agentSelector(),
			"Composer toolbar should show the 'Select agent' control",
		);
	}

	async verifyModelSelectorVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.modelSelector(),
			"Composer toolbar should show the model selector",
		);
	}

	async verifyApprovalSelectorVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.approvalSelector(),
			"Composer toolbar should show the approval-mode control",
		);
	}

	async verifySendVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.sendButton(),
			"Composer toolbar should show the Send control",
		);
	}

	async verifyDraftFooterVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.draftFooter(),
			"Welcome screen should show the composer draft footer",
		);
	}

	async verifyWorkspaceSelectorVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceSelector(),
			"Draft footer should show the 'Select workspace' combobox",
		);
	}
}

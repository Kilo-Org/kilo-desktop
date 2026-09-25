import {
	click,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveCount,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { openNewChatDraft } from "@kilo-desktop/e2e";

export class LayoutPresetsPage {
	async openDraft(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/plugins/chat";
		});
		await openNewChatDraft();
		const send = getLocatorByTestId(/kilo-composer-send(-when-connected)?/);
		await expectElementToBeVisible(send, "Composer should be ready before starting the chat");
		await fill(getLocatorByRole("textbox", { name: "Message input" }), "Start a chat layout");
		await click(send);
		await expectElementToBeVisible(
			getLocatorByTestId("chat-layouts-menu"),
			"Started chats should expose saved layouts",
		);
	}

	async saveDefault(name: string): Promise<void> {
		await click(getLocatorByTestId("chat-layouts-menu"));
		await click(getLocatorByTestId("chat-layout-save-current"));
		await fill(getLocatorByTestId("chat-layout-name"), name);
		await click(getLocatorByTestId("chat-layout-default"));
		await click(getLocatorByTestId("chat-layout-save"));
		await expectElementToHaveCount(getLocatorByTestId("chat-layout-name"), 0, {
			message: "Saving the layout should finish before reloading",
		});
	}

	async reloadAndVerifyDefault(name: string): Promise<void> {
		await getPage().reload();
		await this.openDraft();
		await expectElementToBeVisible(
			getLocatorByTestId("chat-layouts-menu"),
			"Layouts should be available in a new chat after renderer reload",
		);
		await click(getLocatorByTestId("chat-layouts-menu"));
		await expectElementToContainText(
			getLocatorByRole("menuitem", { name: `Apply ${name}`, exact: true }),
			"Default",
			{ message: "The desktop store should preserve the saved default across reload" },
		);
		await click(getLocatorByRole("menuitem", { name: `Apply ${name}`, exact: true }));
		await expectElementToBeVisible(
			getLocatorByTestId("kilo-chat-thread"),
			"Applying a persisted layout should leave the chat available",
		);
	}
}

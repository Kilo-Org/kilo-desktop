import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
	pressPageKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";

import { NewWorkSessionPage } from "./new-work-session-page.js";

/** The Agent pane kind kilo.chat contributes. */
export const AGENT_PANE_KIND = "kilo.chat/agent";

/**
 * The open session's Layouts menu (kilo.work-sessions, behind `chat-layouts`,
 * which `package:e2e` turns on). Presets live in kilo.work-sessions'
 * main-side store, so a saved default survives a window reload and shapes
 * every new empty session.
 */
export class LayoutPresetsPage {
	readonly #newWorkSession = new NewWorkSessionPage();

	private readonly menu = () => getLocatorByTestId("chat-layouts-menu");
	private readonly agentPane = () => getLocatorByTestId("kilo-agent-pane");
	private readonly applyItem = (name: string) =>
		getLocatorByRole("menuitem", { name: `Apply ${name}`, exact: true });

	/** A new empty session with an Agent pane: a layout with one reusable pane to save. */
	async openSessionWithAgentPane(): Promise<void> {
		await this.#newWorkSession.openAndStartEmptySession();
		await click(getLocatorByTestId(`chat-pane-pinned-${AGENT_PANE_KIND}`));
		await click(getLocatorByTestId(`chat-pane-pinned-new-${AGENT_PANE_KIND}`));
		await expectElementToBeVisible(
			this.agentPane(),
			"Adding an Agent pane from the session header's Agent button should show it",
		);
		await expectElementToBeVisible(this.menu(), "An open session should offer its Layouts menu");
	}

	async saveCurrentAsDefault(name: string): Promise<void> {
		await click(this.menu());
		await click(getLocatorByTestId("chat-layout-save-current"));
		await fill(getLocatorByTestId("chat-layout-name"), name);
		await click(getLocatorByTestId("chat-layout-default"));
		await click(getLocatorByTestId("chat-layout-save"));
		await expectElementToBeHidden(getLocatorByTestId("chat-layout-name"), {
			message: "Saving the layout should close the save dialog",
		});
	}

	async reloadWindow(): Promise<void> {
		await reloadPage();
	}

	/** An empty session starts from the default layout: it opens with the saved Agent pane. */
	async verifyNewSessionUsesDefault(name: string): Promise<void> {
		await this.#newWorkSession.openAndStartEmptySession();
		await expectElementToBeVisible(
			this.agentPane(),
			"A new empty session should open with the default layout's Agent pane",
		);
		await click(this.menu());
		await expectElementToContainText(this.applyItem(name), "Default", {
			message: `The Layouts menu should mark "${name}" as the default after a reload`,
		});
		await pressPageKeyboard("Escape");
	}
}

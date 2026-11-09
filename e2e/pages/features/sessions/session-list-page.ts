import type { Locator } from "@playwright/test";

import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	fill,
	getAttribute,
	getLocatorByTestId,
	pressPageKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";
import { runFromCommandPalette } from "../../shell/command-palette.js";

/** Page object for kilo.workbench's session list (the sidebar) and launcher. */
export class SessionListPage {
	private readonly list = () => getLocatorByTestId("kilo-thread-list");
	private readonly row = (title: string): Locator =>
		this.list()
			.getByTestId(/^session-list-(archived-)?item$/)
			.filter({ hasText: title });

	async startSessionFromLauncher(): Promise<void> {
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbench-launcher"),
			"New session should open the launcher",
		);
		await runFromCommandPalette("kilo.workbench/new-empty-session");
		await expectElementToBeVisible(
			getLocatorByTestId("session-workbench"),
			"Starting a session should open it",
		);
	}

	async verifyListed(title: string): Promise<void> {
		await expectElementToBeVisible(this.row(title), `${title} should be listed`);
	}

	async verifyOpen(title: string | RegExp): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("session-breadcrumb").getByText(title, { exact: true }),
			`The header should name ${title}`,
		);
	}

	/** Opens another session from its row in the list. */
	async switchTo(title: string): Promise<void> {
		await click(this.row(title).getByTestId("session-list-item-trigger"));
		await this.verifyOpen(title);
	}

	/** Reloads the window: the list comes back from kilo.sessions' store in main. */
	async reloadWindow(): Promise<void> {
		await reloadPage();
		await expectElementToBeVisible(this.list(), "The session list should show after a reload");
	}

	private async openMenu(title: string): Promise<void> {
		await this.row(title).hover();
		await click(this.row(title).getByTestId("session-list-item-more"));
	}

	async rename(from: string, to: string): Promise<void> {
		await this.openMenu(from);
		await click(getLocatorByTestId("session-menu-rename"));
		await fill(getLocatorByTestId("session-list-item-rename"), to);
		await pressPageKeyboard("Enter");
		await this.verifyListed(to);
	}

	async pin(title: string): Promise<void> {
		await this.openMenu(title);
		await click(getLocatorByTestId("session-menu-pin"));
		await expectElementToBeVisible(
			this.list().getByTestId("session-list-pinned-toggle"),
			"A pinned session should sit under Pinned",
		);
	}

	async archive(title: string): Promise<void> {
		await this.openMenu(title);
		await click(getLocatorByTestId("session-menu-archive"));
		await expectElementToBeHidden(this.row(title), {
			message: "An archived session should leave the active list",
		});
	}

	/** Deletes an archived session, expanding the Archived shelf first when it is collapsed. */
	async delete(title: string): Promise<void> {
		const archivedToggle = this.list().getByTestId("session-list-archived-toggle");
		if ((await getAttribute(archivedToggle, "aria-expanded")) !== "true") {
			await click(archivedToggle);
		}
		await this.openMenu(title);
		await click(getLocatorByTestId("session-menu-delete"));
		await click(getLocatorByTestId("session-delete-confirm"));
		await expectElementToBeHidden(this.row(title), {
			message: "A deleted session should leave the list",
		});
	}
}

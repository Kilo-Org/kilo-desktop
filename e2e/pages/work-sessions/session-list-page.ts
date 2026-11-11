import type { Locator } from "@playwright/test";

import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	fill,
	getAttribute,
	getLocatorByTestId,
	hover,
	isElementVisible,
	pressPageKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";

import { NewWorkSessionPage } from "./new-work-session-page.js";

/** Page object for kilo.work-sessions' session list (the sidebar). */
export class SessionListPage {
	readonly #newWorkSession = new NewWorkSessionPage();

	private readonly list = () => getLocatorByTestId("kilo-thread-list");
	private readonly row = (title: string): Locator =>
		this.list()
			.getByTestId(/^session-list-(archived-)?item$/)
			.filter({ hasText: title });

	/** Opens the New Session page and starts an empty session from it. */
	async startSessionFromNewSessionPage(): Promise<void> {
		await this.#newWorkSession.openAndStartEmptySession();
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

	/** Reloads the window: the list comes back from kilo.work-sessions' store in main. */
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

	/** The same menu entry unpins; it reads "Unpin" once the session is pinned. */
	async unpin(title: string): Promise<void> {
		await this.openMenu(title);
		await click(getLocatorByTestId("session-menu-pin"));
		await expectElementToBeHidden(this.list().getByTestId("session-list-pinned-toggle"), {
			message: "Unpinning the only pinned session should drop the Pinned shelf",
		});
	}

	/**
	 * Shift+Click selects the row for a bulk action rather than opening it —
	 * the same modifier the list uses to extend a selection with the keyboard.
	 */
	async selectWithShiftClick(title: string): Promise<void> {
		await click(this.row(title).getByTestId("session-list-item-trigger"), {
			modifiers: ["Shift"],
		});
	}

	async verifySelected(title: string): Promise<void> {
		await expectElementToHaveAttribute(this.row(title), "data-selected", "true", {
			message: `${title} should be selected`,
		});
	}

	/**
	 * Opens the row menu to inspect it. The row's timestamp slot only fades on
	 * hover rather than leaving the layer, so it can sit over the "…" trigger
	 * and swallow the click; the trigger itself is visible and stable, so the
	 * hit-target check is the only thing in the way.
	 */
	async openRowMenu(title: string): Promise<void> {
		await hover(this.row(title));
		await click(this.row(title).getByTestId("session-list-item-more"), { force: true });
	}

	async verifyRowMenuOffersSessionActions(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("session-menu-pin"),
			"The row menu should offer Pin",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("session-menu-rename"),
			"The row menu should offer Rename",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("session-menu-delete"),
			"The row menu should offer Delete",
		);
	}

	async verifyRowMenuClosed(): Promise<void> {
		await expectElementToBeHidden(getLocatorByTestId("session-menu-rename"), {
			message: "The row menu should be closed",
		});
	}

	/**
	 * Deletes the session wherever it sits. `delete` is for an archived one and
	 * reads the Archived toggle, which is absent while nothing is archived —
	 * this checks for the shelf before expanding it, so it suits teardown that
	 * runs after either outcome.
	 */
	async deleteAnywhere(title: string): Promise<void> {
		const archivedToggle = this.list().getByTestId("session-list-archived-toggle");
		if (
			(await isElementVisible(archivedToggle)) &&
			(await getAttribute(archivedToggle, "aria-expanded")) !== "true"
		) {
			await click(archivedToggle);
		}
		await this.openRowMenu(title);
		await click(getLocatorByTestId("session-menu-delete"));
		await click(getLocatorByTestId("session-delete-confirm"));
		await expectElementToBeHidden(this.row(title), {
			message: `${title} should leave the list once deleted`,
		});
	}

	/** The row as it renders on the Archived shelf, which must be expanded first. */
	async verifyArchivedListed(title: string): Promise<void> {
		await expectElementToBeVisible(
			this.list().getByTestId("session-list-archived-item").filter({ hasText: title }),
			`${title} should be listed on the Archived shelf`,
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

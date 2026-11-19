import { expect, type Locator } from "@playwright/test";

import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	fill,
	focus,
	getAttribute,
	getLocatorByTestId,
	getLocatorByText,
	getLocatorCount,
	hover,
	isElementVisible,
	pressPageKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";

import { sessionListData } from "../../testdata/work-sessions/session-list.js";
import { callDomainObject } from "../../utils/kernel-bridge.js";
import {
	createAndActivateWorkspace,
	NewWorkSessionPage,
	WORK_SESSIONS_CALLER,
} from "./new-work-session-page.js";

const SESSION_LIST = sessionListData.locators;

/** Page object for kilo.work-sessions' session list (the sidebar). */
export class SessionListPage {
	readonly #newWorkSession = new NewWorkSessionPage();

	private readonly list = () => getLocatorByTestId(SESSION_LIST.listTestId);
	private readonly row = (title: string): Locator =>
		this.list()
			.getByTestId(/^session-list-(archived-)?item$/)
			.filter({ hasText: title });
	/**
	 * The row only while it is active. `row` matches the archived variant too,
	 * so it stays "visible" once the Archived shelf is expanded — which makes
	 * any "it left the list" assertion depend on the shelf's state.
	 */
	private readonly activeRow = (title: string): Locator =>
		this.list().getByTestId(SESSION_LIST.itemTestId).filter({ hasText: title });

	private readonly renameInput = () => getLocatorByTestId(SESSION_LIST.itemRenameTestId);

	/** Opens the New Session page and starts an empty session from it. */
	async startSessionFromNewSessionPage(): Promise<void> {
		await this.#newWorkSession.openAndStartEmptySession();
	}

	/**
	 * Seeds sessions straight through the domain object. Starting them from the
	 * New Session page costs a second each, which a virtualized list needs far
	 * too many of to be worth doing through the UI.
	 */
	async seedSessions(titles: readonly string[]): Promise<void> {
		for (const title of titles) {
			await callDomainObject({
				domainId: "kilo.work-sessions/work-sessions",
				method: "create",
				input: { title },
				caller: WORK_SESSIONS_CALLER,
			});
		}
	}

	/** Registers a workspace and makes it the active one (test setup). */
	async createWorkspaceAt(folderPath: string, name: string): Promise<string> {
		return createAndActivateWorkspace(folderPath, name);
	}

	/** Asks main to re-check which workspace folders it can still reach. */
	async recheckWorkspaceFolders(): Promise<void> {
		await callDomainObject({
			domainId: "kilo.work-sessions/workspaces",
			method: "checkFolders",
			caller: WORK_SESSIONS_CALLER,
		});
	}

	/** Seeds one session inside a workspace, so the filter has both kinds to sort. */
	async seedSessionInWorkspace(title: string, workspaceId: string): Promise<void> {
		await callDomainObject({
			domainId: "kilo.work-sessions/work-sessions",
			method: "create",
			input: { title, workspaceId },
			caller: WORK_SESSIONS_CALLER,
		});
	}

	/** Starts an inline rename from the row menu, leaving the field open. */
	async startRename(title: string): Promise<void> {
		await this.openRowMenu(title);
		await click(getLocatorByTestId(SESSION_LIST.menuRenameTestId));
		await expectElementToBeVisible(this.renameInput(), "The rename field should open");
	}

	async typeRenameTitle(next: string): Promise<void> {
		await fill(this.renameInput(), next);
	}

	async cancelRename(): Promise<void> {
		await pressPageKeyboard("Escape");
	}

	async commitRename(): Promise<void> {
		await pressPageKeyboard("Enter");
	}

	async verifyRenameClosed(): Promise<void> {
		await expectElementToBeHidden(this.renameInput(), {
			message: "The rename field should close",
		});
	}

	/** Adds a row to the selection without opening it. */
	async selectWithMetaClick(title: string): Promise<void> {
		await click(this.row(title).getByTestId(SESSION_LIST.itemTriggerTestId), {
			modifiers: ["Meta"],
		});
	}

	/** The selection's own menu, which the rows open on right-click. */
	async openSelectionMenu(title: string): Promise<void> {
		await click(this.row(title), { button: "right" });
	}

	async verifySelectionCount(count: number): Promise<void> {
		await expectElementToBeVisible(getLocatorByText(`${count} sessions selected`), {
			message: `The selection menu should name ${count} sessions`,
		});
	}

	async restoreSelection(): Promise<void> {
		await click(getLocatorByTestId(SESSION_LIST.bulkRestoreTestId));
	}

	async verifyBulkArchiveAbsent(): Promise<void> {
		await expectElementToBeHidden(getLocatorByTestId(SESSION_LIST.bulkArchiveTestId), {
			message: "An already-archived selection should not offer Archive",
		});
	}

	/** How many rows the virtualized list is holding in the DOM right now. */
	async mountedRowCount(): Promise<number> {
		return getLocatorCount(this.list().getByTestId(SESSION_LIST.itemTestId));
	}

	async verifyFewerRowsMountedThan(total: number): Promise<void> {
		const mounted = await this.mountedRowCount();
		expect(mounted, "The list should mount some rows").toBeGreaterThan(0);
		expect(mounted, `The list should mount fewer than all ${total} sessions`).toBeLessThan(total);
	}

	/** Listed and not archived — restoring puts a session back here. */
	async verifyActiveListed(title: string): Promise<void> {
		await expectElementToBeVisible(
			this.activeRow(title),
			`${title} should be back in the active list`,
		);
	}

	async verifyNotListed(title: string): Promise<void> {
		await expectElementToBeHidden(this.row(title), {
			message: `${title} should not be mounted yet`,
		});
	}

	async focusRow(title: string): Promise<void> {
		await focus(this.row(title).getByTestId(SESSION_LIST.itemTriggerTestId));
	}

	async pressArrowDown(times: number): Promise<void> {
		for (let step = 0; step < times; step += 1) {
			await pressPageKeyboard("ArrowDown");
		}
	}

	// The library has no focus assertion, so this uses Playwright's, as the
	// chat find page object does.
	async verifyRowFocused(title: string): Promise<void> {
		await expect(
			this.row(title).getByTestId(SESSION_LIST.itemTriggerTestId),
			`${title} should hold the focus`,
		).toBeFocused();
	}

	/**
	 * The row list carries every session's height, not just the mounted rows',
	 * so the scrollbar represents the whole history. Geometry and scrolling by
	 * pixel have no wrapper in the library.
	 */
	async verifyRowListTallerThanViewport(): Promise<void> {
		const rows = await this.list().getByTestId(SESSION_LIST.virtualListTestId).boundingBox();
		const inbox = await this.list().getByTestId(SESSION_LIST.inboxTestId).boundingBox();
		expect(
			rows?.height ?? 0,
			"The row list should span more than the visible inbox",
		).toBeGreaterThan(inbox?.height ?? 0);
	}

	async scrollToBottom(): Promise<void> {
		await this.list()
			.getByTestId(SESSION_LIST.inboxTestId)
			.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
	}

	async verifyListed(title: string): Promise<void> {
		await expectElementToBeVisible(this.row(title), `${title} should be listed`);
	}

	async verifyOpen(title: string | RegExp): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId(SESSION_LIST.breadcrumbTestId).getByText(title, { exact: true }),
			`The header should name ${title}`,
		);
	}

	/** Opens another session from its row in the list. */
	async switchTo(title: string): Promise<void> {
		await click(this.row(title).getByTestId(SESSION_LIST.itemTriggerTestId));
		await this.verifyOpen(title);
	}

	/** Reloads the window: the list comes back from kilo.work-sessions' store in main. */
	async reloadWindow(): Promise<void> {
		await reloadPage();
		await expectElementToBeVisible(this.list(), "The session list should show after a reload");
	}

	private async openMenu(title: string): Promise<void> {
		await this.row(title).hover();
		await click(this.row(title).getByTestId(SESSION_LIST.itemMoreTestId));
	}

	async rename(from: string, to: string): Promise<void> {
		await this.openMenu(from);
		await click(getLocatorByTestId(SESSION_LIST.menuRenameTestId));
		await fill(getLocatorByTestId(SESSION_LIST.itemRenameTestId), to);
		await pressPageKeyboard("Enter");
		await this.verifyListed(to);
	}

	async pin(title: string): Promise<void> {
		await this.openMenu(title);
		await click(getLocatorByTestId(SESSION_LIST.menuPinTestId));
		await expectElementToBeVisible(
			this.list().getByTestId(SESSION_LIST.pinnedToggleTestId),
			"A pinned session should sit under Pinned",
		);
	}

	/** The same menu entry unpins; it reads "Unpin" once the session is pinned. */
	async unpin(title: string): Promise<void> {
		await this.openMenu(title);
		await click(getLocatorByTestId(SESSION_LIST.menuPinTestId));
		await expectElementToBeHidden(this.list().getByTestId(SESSION_LIST.pinnedToggleTestId), {
			message: "Unpinning the only pinned session should drop the Pinned shelf",
		});
	}

	/**
	 * Shift+Click selects the row for a bulk action rather than opening it —
	 * the same modifier the list uses to extend a selection with the keyboard.
	 */
	async selectWithShiftClick(title: string): Promise<void> {
		await click(this.row(title).getByTestId(SESSION_LIST.itemTriggerTestId), {
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
		await click(this.row(title).getByTestId(SESSION_LIST.itemMoreTestId), { force: true });
	}

	async verifyRowMenuOffersSessionActions(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId(SESSION_LIST.menuPinTestId),
			"The row menu should offer Pin",
		);
		await expectElementToBeVisible(
			getLocatorByTestId(SESSION_LIST.menuRenameTestId),
			"The row menu should offer Rename",
		);
		await expectElementToBeVisible(
			getLocatorByTestId(SESSION_LIST.menuDeleteTestId),
			"The row menu should offer Delete",
		);
	}

	async verifyRowMenuClosed(): Promise<void> {
		await expectElementToBeHidden(getLocatorByTestId(SESSION_LIST.menuRenameTestId), {
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
		const archivedToggle = this.list().getByTestId(SESSION_LIST.archivedToggleTestId);
		if (
			(await isElementVisible(archivedToggle)) &&
			(await getAttribute(archivedToggle, "aria-expanded")) !== "true"
		) {
			await click(archivedToggle);
		}
		await this.openRowMenu(title);
		await click(getLocatorByTestId(SESSION_LIST.menuDeleteTestId));
		await click(getLocatorByTestId(SESSION_LIST.deleteConfirmTestId));
		await expectElementToBeHidden(this.row(title), {
			message: `${title} should leave the list once deleted`,
		});
	}

	/** The row as it renders on the Archived shelf, which must be expanded first. */
	async verifyArchivedListed(title: string): Promise<void> {
		await expectElementToBeVisible(
			this.list().getByTestId(SESSION_LIST.archivedItemTestId).filter({ hasText: title }),
			`${title} should be listed on the Archived shelf`,
		);
	}

	async archive(title: string): Promise<void> {
		await this.openMenu(title);
		await click(getLocatorByTestId(SESSION_LIST.menuArchiveTestId));
		await expectElementToBeHidden(this.activeRow(title), {
			message: "An archived session should leave the active list",
		});
	}

	/** Deletes an archived session, expanding the Archived shelf first when it is collapsed. */
	async delete(title: string): Promise<void> {
		const archivedToggle = this.list().getByTestId(SESSION_LIST.archivedToggleTestId);
		if ((await getAttribute(archivedToggle, "aria-expanded")) !== "true") {
			await click(archivedToggle);
		}
		await this.openMenu(title);
		await click(getLocatorByTestId(SESSION_LIST.menuDeleteTestId));
		await click(getLocatorByTestId(SESSION_LIST.deleteConfirmTestId));
		await expectElementToBeHidden(this.row(title), {
			message: "A deleted session should leave the list",
		});
	}
}

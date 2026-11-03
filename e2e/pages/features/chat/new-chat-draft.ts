import {
	click,
	expectElementToBeEnabled,
	expectElementToBeVisible,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { expect } from "@playwright/test";

const DRAFT_SETTLED_TIMEOUT_MS = 30_000;
const DRAFT_PROBE_TIMEOUT_MS = 5_000;

/**
 * Show a chat draft: the New Session page's session starter (or an Agent
 * pane before its first message), which is exactly when the composer draft
 * footer renders.
 *
 * A one-shot "footer present? otherwise click New session" check raced the
 * runtime: right after a hash reset or thread-list hydration the active
 * thread can still switch, so the footer seen at check time could disappear
 * (or a click could land mid-switch) and the test waited out its budget on a
 * regular thread. Converge instead: whenever the footer is absent, click New
 * Chat once it is enabled and re-check, until a draft is showing.
 */
export async function openNewChatDraft(): Promise<void> {
	const newChat = getLocatorByTestId("new-chat");
	const draftFooter = getLocatorByTestId("kilo-composer-draft-footer");
	await expect(async () => {
		if (!(await draftFooter.isVisible())) {
			await expectElementToBeEnabled(newChat, "New session should be enabled once threads load");
			await click(newChat);
		}
		await expectElementToBeVisible(draftFooter, {
			message: "New session should show a draft",
			timeout: DRAFT_PROBE_TIMEOUT_MS,
		});
	}).toPass({ timeout: DRAFT_SETTLED_TIMEOUT_MS });
}

/** Scope the current draft to a workspace through the draft footer's selector. */
export async function selectDraftWorkspace(workspaceName: string): Promise<void> {
	await click(getLocatorByRole("combobox", { name: "Select workspace" }));
	await click(
		getLocatorByRole("listbox", { name: "Suggestions" }).getByText(workspaceName, { exact: true }),
	);
}

import { expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

import { openNewChatDraft } from "./new-chat-draft.js";

/**
 * Put the chat into a fresh draft (which mounts the agent transcript and its
 * find scope) and open the find bar with the platform find chord.
 */
export async function openChatFindBar(): Promise<void> {
	await openNewChatDraft();
	await getPage().keyboard.press("ControlOrMeta+f");
	await expectElementToBeVisible(getLocatorByTestId("chat-find-bar"), {
		message: "The find bar should open on the find chord.",
	});
}

export async function verifyFindInputFocused(): Promise<void> {
	await expect(getLocatorByTestId("chat-find-input")).toBeFocused();
}

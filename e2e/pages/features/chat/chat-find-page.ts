import { expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

import { openAgentPaneInNewSession } from "./agent-session.js";

/**
 * Add an Agent pane (which holds the transcript and its find scope) to a new
 * session and open the find bar with the platform find chord. The New Session
 * page's starter has no transcript, so the pane comes from the session header.
 */
export async function openChatFindBar(): Promise<void> {
	await openAgentPaneInNewSession();
	await getPage().keyboard.press("ControlOrMeta+f");
	await expectElementToBeVisible(getLocatorByTestId("chat-find-bar"), {
		message: "The find bar should open on the find chord.",
	});
}

export async function verifyFindInputFocused(): Promise<void> {
	await expect(getLocatorByTestId("chat-find-input")).toBeFocused();
}

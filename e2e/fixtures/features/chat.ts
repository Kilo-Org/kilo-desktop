import { ChatComposerPage } from "../../pages/features/chat/chat-composer-page.js";
import { test as shellTest } from "../shell.js";

type ChatFixtures = {
	chatComposerPage: ChatComposerPage;
};

export const test = shellTest.extend<ChatFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatComposerPage: async ({}, use) => {
		await use(new ChatComposerPage());
	},
});

test.use({ appIsolationKey: "chat" });

export const { expect } = test;

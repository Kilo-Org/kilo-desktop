import { ChatComposerPage } from "../../pages/features/chat/chat-composer-page.js";
import { ChatWelcomePage } from "../../pages/features/chat/chat-welcome-page.js";
import { test as shellTest } from "../shell.js";

type ChatFixtures = {
	chatComposerPage: ChatComposerPage;
	chatWelcomePage: ChatWelcomePage;
};

export const test = shellTest.extend<ChatFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatComposerPage: async ({}, use) => {
		await use(new ChatComposerPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatWelcomePage: async ({}, use) => {
		await use(new ChatWelcomePage());
	},
});

test.use({ appIsolationKey: "chat" });

export const { expect } = test;

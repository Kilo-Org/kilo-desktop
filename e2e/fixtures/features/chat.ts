import { ChatApprovalSelectorPage } from "../../pages/features/chat/chat-approval-selector-page.js";
import { ChatComposerPage } from "../../pages/features/chat/chat-composer-page.js";
import { ChatModeSelectorPage } from "../../pages/features/chat/chat-mode-selector-page.js";
import { ChatWelcomePage } from "../../pages/features/chat/chat-welcome-page.js";
import { test as shellTest } from "../shell.js";

type ChatFixtures = {
	chatApprovalSelectorPage: ChatApprovalSelectorPage;
	chatComposerPage: ChatComposerPage;
	chatModeSelectorPage: ChatModeSelectorPage;
	chatWelcomePage: ChatWelcomePage;
};

export const test = shellTest.extend<ChatFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatApprovalSelectorPage: async ({}, use) => {
		await use(new ChatApprovalSelectorPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatComposerPage: async ({}, use) => {
		await use(new ChatComposerPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatModeSelectorPage: async ({}, use) => {
		await use(new ChatModeSelectorPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatWelcomePage: async ({}, use) => {
		await use(new ChatWelcomePage());
	},
});

test.use({ appIsolationKey: "chat" });

export const { expect } = test;

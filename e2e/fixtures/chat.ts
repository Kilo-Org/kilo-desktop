import { ChatApprovalSelectorPage } from "../pages/chat/chat-approval-selector-page.js";
import { ChatStubProviderPage } from "../pages/chat/chat-stub-provider-page.js";
import { ChatComposerPage } from "../pages/chat/chat-composer-page.js";
import { ChatModeSelectorPage } from "../pages/chat/chat-mode-selector-page.js";
import { ChatModelSelectorPage } from "../pages/chat/chat-model-selector-page.js";
import { DesktopToolsPage } from "../pages/chat/desktop-tools-page.js";
import { NewChatPage } from "../pages/chat/new-chat-page.js";
import { test as workSessionsTest } from "./work-sessions.js";

type ChatFixtures = {
	chatApprovalSelectorPage: ChatApprovalSelectorPage;
	chatStubProviderPage: ChatStubProviderPage;
	chatComposerPage: ChatComposerPage;
	chatModeSelectorPage: ChatModeSelectorPage;
	chatModelSelectorPage: ChatModelSelectorPage;
	desktopToolsPage: DesktopToolsPage;
	newChatPage: NewChatPage;
};

/**
 * kilo.chat's composer, transcript and selectors, in an app of their own:
 * the specs start work sessions (and Kilo chats) from the New Session page,
 * with kilo.work-sessions' session list and New Session page at hand.
 */
export const test = workSessionsTest.extend<ChatFixtures>({
	appIsolationKey: "chat",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatApprovalSelectorPage: async ({}, use) => {
		await use(new ChatApprovalSelectorPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	chatStubProviderPage: async ({}, use) => {
		await use(new ChatStubProviderPage());
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
	chatModelSelectorPage: async ({}, use) => {
		await use(new ChatModelSelectorPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	desktopToolsPage: async ({}, use) => {
		await use(new DesktopToolsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	newChatPage: async ({}, use) => {
		await use(new NewChatPage());
	},
});

export const { expect } = test;

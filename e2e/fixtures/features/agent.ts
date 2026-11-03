import { AgentServerPage } from "../../pages/features/agent/agent-server-page.js";
import { AgentToolsPage } from "../../pages/features/agent/agent-tools-page.js";
import { AiProvidersPage } from "../../pages/features/agent/ai-providers-page.js";
import { ExternalAiAppsPage } from "../../pages/features/agent/external-ai-apps-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{
	agentServerPage: AgentServerPage;
	agentToolsPage: AgentToolsPage;
	aiProvidersPage: AiProvidersPage;
	externalAiAppsPage: ExternalAiAppsPage;
}>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	agentServerPage: async ({}, use) => {
		await use(new AgentServerPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	agentToolsPage: async ({}, use) => {
		await use(new AgentToolsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	aiProvidersPage: async ({}, use) => {
		await use(new AiProvidersPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	externalAiAppsPage: async ({}, use) => {
		await use(new ExternalAiAppsPage());
	},
});

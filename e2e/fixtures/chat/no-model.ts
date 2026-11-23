import { test as chatTest } from "../chat.js";

export const test = chatTest.extend<Record<never, never>, { appLaunchEnv: Record<string, string> }>(
	{
		appIsolationKey: "chat-no-model",
		appLaunchEnv: [
			// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
			async ({}, use) => {
				await use({
					KILO_DISABLE_MODELS_FETCH: "1",
					KILO_API_URL: "http://127.0.0.1:1",
				});
			},
			{ scope: "worker" },
		],
	},
);

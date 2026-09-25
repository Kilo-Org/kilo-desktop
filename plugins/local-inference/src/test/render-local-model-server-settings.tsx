import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { page } from "vitest/browser";

import type { AuthSession, ChannelHandlerMap, SDK, SdkNavigation } from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { localInferenceContract } from "../contracts/schemas.js";
import { LocalModelServerSettings } from "../web/settings/LocalModelServerSettings.js";

export type LocalInferenceHandlers = ChannelHandlerMap<typeof localInferenceContract>;

export const usageSnapshot = {
	system: {
		cpuPercent: 48.4,
		cpuSpeedGHz: 3.5,
		gpuMemoryUsedBytes: 4 * 1024 ** 3,
		gpuMemoryTotalBytes: 8 * 1024 ** 3,
		memoryUsedBytes: 10 * 1024 ** 3,
		memoryTotalBytes: 16 * 1024 ** 3,
	},
};

export const connection = {
	baseUrl: "http://127.0.0.1:59632/v1",
	port: 59_632,
	apiKey: "local-secret",
};

const authenticatedSession: AuthSession = {
	status: "authenticated",
	user: { email: "test@example.com" },
};

export const authenticatedAuth: Partial<SDK["auth"]> = {
	subscribe(listener) {
		listener(authenticatedSession);
		return () => undefined;
	},
	peek: () => authenticatedSession,
};

export function renderSettings(
	handlers: Partial<LocalInferenceHandlers>,
	shell: Partial<SDK["shell"]> = {},
	auth: Partial<SDK["auth"]> = authenticatedAuth,
	navigation?: Partial<SdkNavigation>,
) {
	const sdk = createFakeSdk({
		featureId: "local-inference",
		channels: localInferenceContract,
		handlers: {
			"models.list": async () => [],
			"catalog.downloads.list": async () => [],
			...handlers,
		},
		shell,
		auth,
		...(navigation ? { navigation } : {}),
	});
	const system = createFakeFeatureSystem({ sdks: { "local-inference": sdk } });
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const view = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<LocalModelServerSettings />
			</QueryClientProvider>
		</SdkProvider>,
	);

	return { ...view, sdk };
}

export async function expandModel(baseElement: HTMLElement, modelId: string) {
	const trigger = page.elementLocator(baseElement).getByTestId(`local-model-trigger-${modelId}`);
	await trigger.click();
	return page.elementLocator(baseElement).getByTestId(`local-model-details-${modelId}`);
}

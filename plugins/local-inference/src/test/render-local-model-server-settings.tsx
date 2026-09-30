import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
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
	getSession: async () => authenticatedSession,
	refresh: async () => authenticatedSession,
};

export function renderSettings(
	handlers: Partial<LocalInferenceHandlers>,
	shell: Partial<SDK["shell"]> = {},
	auth: Partial<SDK["auth"]> = authenticatedAuth,
	navigation?: Partial<SdkNavigation>,
	featureFlags: Partial<SDK["featureFlags"]> = {},
) {
	// The model catalog is flag-gated (local-model-catalog, off by default);
	// most settings tests exercise it, so default it on and let callers opt out.
	// The model catalog is flag-gated (local-model-catalog, off by default);
	// most settings tests exercise it, so default it on and let callers opt out.
	// useFeatureFlag reads shellDelegates.featureFlags.peek(), so set it there.
	const flags = { "local-model-catalog": true, ...(featureFlags.peek?.() ?? {}) };
	const track = vi.fn(async (_input: { event: string; data: Record<string, unknown> }) => {});
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
		telemetry: { track },
		...(navigation ? { navigation } : {}),
	});
	sdk.services.shellDelegates.featureFlags = {
		getAllFlags: async () => flags,
		peek: () => flags,
		subscribe: (fn) => {
			fn(flags);
			return () => undefined;
		},
	};
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

	return { ...view, sdk, track };
}

export async function expandModel(baseElement: HTMLElement, modelId: string) {
	const trigger = page.elementLocator(baseElement).getByTestId(`local-model-trigger-${modelId}`);
	await trigger.click();
	return page.elementLocator(baseElement).getByTestId(`local-model-details-${modelId}`);
}

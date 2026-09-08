import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";

import type { ChannelHandlerMap, SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";
import { SidebarProvider } from "@anaconda-agentic-desktop/ui/components/sidebar";

import { localInferenceContract } from "../contracts/schemas.js";
import { LocalModelServerSettings } from "../web/LocalModelServerSettings.js";

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

export function renderSettings(
	handlers: Partial<LocalInferenceHandlers>,
	shell: Partial<SDK["shell"]> = {},
) {
	const sdk = createFakeSdk({
		featureId: "local-inference",
		channels: localInferenceContract,
		handlers: {
			"models.list": async () => [],
			...handlers,
		},
		shell,
	});
	const system = createFakeFeatureSystem({ sdks: { "local-inference": sdk } });
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const view = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<SidebarProvider>
					<LocalModelServerSettings />
				</SidebarProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);

	return { ...view, sdk };
}

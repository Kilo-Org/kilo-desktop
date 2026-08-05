import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { LocalApi } from "@anaconda-agentic-desktop/contracts";

import { PluginProviderStack } from "@/features/plugin-providers";
import { createDesktopQueryClient } from "@/lib/query/client";
import { LocalApiProvider } from "@/platform/LocalApiProvider";
import { SdkProvider, type FeatureSystem } from "@anaconda-agentic-desktop/sdk-react";
import { router } from "@/router";

type AppProvidersProps = {
	localApi: LocalApi;
	system: FeatureSystem;
	children?: ReactNode;
};

/**
 * Shared provider stack used by `main.tsx` and app-level browser tests.
 * When `children` is omitted, renders the app router (production path).
 */
export function AppProviders({ localApi, system, children }: AppProvidersProps) {
	const [queryClient] = useState(() => createDesktopQueryClient());

	return (
		<LocalApiProvider api={localApi}>
			<SdkProvider system={system}>
				<QueryClientProvider client={queryClient}>
					<PluginProviderStack>
						{children ?? <RouterProvider router={router} />}
					</PluginProviderStack>
				</QueryClientProvider>
			</SdkProvider>
		</LocalApiProvider>
	);
}

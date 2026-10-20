import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { LocalApi } from "@kilo-desktop/contracts";

import { PluginProviderStack } from "@/features/plugin-providers";
import { ShortcutsHost } from "@/features/shortcuts/ShortcutsHost";
import { createDesktopQueryClient } from "@/lib/query/client";
import { LocalApiProvider } from "@/platform/LocalApiProvider";
import { ShellNavigationListener } from "@/platform/ShellNavigationListener";
import { UpdateProvider } from "@/platform/updates/UpdateProvider";
import { SdkProvider, type FeatureSystem } from "@kilo-desktop/sdk-react";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";
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
			<ShellNavigationListener />
			<UpdateProvider>
				<SdkProvider system={system}>
					<QueryClientProvider client={queryClient}>
						{/* One provider for the whole app so adjacent tooltips share the
						    open delay; features must not add their own. */}
						<TooltipProvider>
							<ShortcutsHost />
							<PluginProviderStack>
								{children ?? <RouterProvider router={router} />}
							</PluginProviderStack>
						</TooltipProvider>
					</QueryClientProvider>
				</SdkProvider>
			</UpdateProvider>
		</LocalApiProvider>
	);
}

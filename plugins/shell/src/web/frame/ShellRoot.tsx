import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type AnyRouter } from "@tanstack/react-router";

import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import { ShellUiProvider, type ShellUiState } from "./ui-state";

/**
 * The main window's root (kilo.shell's kernel/root contribution): app-wide
 * providers that contributed views can rely on, then the router and frame.
 */
export function ShellRoot({
	router,
	ui,
}: {
	readonly router: AnyRouter;
	readonly ui: ShellUiState;
}) {
	const [queryClient] = useState(
		() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
	);
	return (
		<ShellUiProvider value={ui}>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<RouterProvider router={router} />
				</TooltipProvider>
			</QueryClientProvider>
		</ShellUiProvider>
	);
}

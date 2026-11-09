import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { KiloProvidersSettings } from "./KiloProvidersSettings";

/** kilo.agent's renderer query cache (per window), shared by its pages. */
export const agentQueryClient = new QueryClient();

/** Settings → AI Providers. */
export function AiProvidersPage() {
	return (
		<QueryClientProvider client={agentQueryClient}>
			<KiloProvidersSettings />
		</QueryClientProvider>
	);
}

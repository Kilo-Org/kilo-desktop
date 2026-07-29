import { createFileRoute } from "@tanstack/react-router";

import { SdkExplorerView } from "@/features/sdk-explorer/SdkExplorerView";

export const Route = createFileRoute("/sdk-explorer")({
	component: SdkExplorerView,
});

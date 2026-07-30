import { createFileRoute } from "@tanstack/react-router";

import { SdkConsumerView } from "@/features/sdk-consumer/SdkConsumerView";
import { SdkExplorerView } from "@/features/sdk-explorer/SdkExplorerView";

/**
 * Split view: both features rendered simultaneously to demonstrate
 * real-time cross-feature communication (events, state, capabilities).
 */
function SplitView() {
	return (
		<div className="divide-border grid grid-cols-2 divide-x">
			<div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 40px)" }}>
				<SdkExplorerView />
			</div>
			<div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 40px)" }}>
				<SdkConsumerView />
			</div>
		</div>
	);
}

export const Route = createFileRoute("/split")({
	component: SplitView,
});

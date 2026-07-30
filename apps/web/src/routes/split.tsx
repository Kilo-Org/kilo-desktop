import { createFileRoute } from "@tanstack/react-router";

import { SdkConsumerView } from "@/features/sdk-consumer/SdkConsumerView";
import { SdkProducerView } from "@/features/sdk-producer/SdkProducerView";

/**
 * Split view: both features rendered simultaneously to demonstrate
 * real-time cross-feature communication (events, state, capabilities).
 */
function SplitView() {
	return (
		<div className="divide-border grid min-h-0 flex-1 grid-cols-2 divide-x overflow-hidden">
			<div className="min-w-0 overflow-y-auto">
				<SdkProducerView />
			</div>
			<div className="min-w-0 overflow-y-auto">
				<SdkConsumerView />
			</div>
		</div>
	);
}

export const Route = createFileRoute("/split")({
	component: SplitView,
});

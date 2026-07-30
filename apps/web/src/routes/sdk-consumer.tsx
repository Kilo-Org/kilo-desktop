import { createFileRoute } from "@tanstack/react-router";

import { SdkConsumerView } from "@/features/sdk-consumer/SdkConsumerView";

export const Route = createFileRoute("/sdk-consumer")({
	component: SdkConsumerView,
});

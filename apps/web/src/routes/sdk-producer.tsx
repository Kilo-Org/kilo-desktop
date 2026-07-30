import { createFileRoute } from "@tanstack/react-router";

import { SdkProducerView } from "@/features/sdk-producer/SdkProducerView";

export const Route = createFileRoute("/sdk-producer")({
	component: SdkProducerView,
});

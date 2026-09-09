import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { ModelCatalogEntry } from "../../contracts/schemas.js";
import { getPublisherDisplayName, ModelPublisherIcon } from "./ModelPublisherIcon.js";

export function ModelIdentity({
	model,
	compact = false,
}: {
	model: ModelCatalogEntry;
	compact?: boolean;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<div className={cn("flex min-w-0 items-center gap-1.5 font-medium", compact && "text-sm")}>
				<ModelPublisherIcon publisher={model.publisher} />
				<span className="truncate">{model.name}</span>
			</div>
			<span
				className="text-muted-foreground truncate text-xs"
				data-qa-id={compact ? "recommended-model-publisher" : "model-publisher"}
			>
				{getPublisherDisplayName(model.publisher)}
			</span>
		</div>
	);
}

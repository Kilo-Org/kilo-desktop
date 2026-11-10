import { CodeXmlIcon, GaugeIcon, type LucideIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";

import type { LocalInferenceHardwareProfile, ModelCatalogEntry } from "../../contracts/index";
import {
	getCatalogRecommendations,
	type ModelRecommendation,
} from "../../shared/catalog/model-recommendations";
import { ModelIdentity } from "./ModelIdentity";
import { ModelPerformance } from "./ModelPerformance";

export function ModelRecommendations({
	models,
	hardware,
	onSelectModel,
	selectedModelId,
}: {
	models: ModelCatalogEntry[];
	hardware: LocalInferenceHardwareProfile;
	onSelectModel: (model: ModelCatalogEntry) => void;
	selectedModelId?: string | undefined;
}) {
	const recommendations = getCatalogRecommendations(models, hardware);

	return (
		<section className="mb-6" data-qa-id="model-recommendations">
			<h2 className="mb-3 text-sm font-medium">Recommended Models</h2>
			<div className="grid gap-3 lg:grid-cols-2">
				<RecommendationGroup
					icon={CodeXmlIcon}
					title="Chat & coding"
					recommendations={recommendations.coding}
					onSelectModel={onSelectModel}
					selectedModelId={selectedModelId}
				/>
				<RecommendationGroup
					icon={GaugeIcon}
					title="Lightweight models"
					recommendations={recommendations.small}
					onSelectModel={onSelectModel}
					selectedModelId={selectedModelId}
				/>
			</div>
		</section>
	);
}

function RecommendationGroup({
	icon: Icon,
	title,
	recommendations,
	onSelectModel,
	selectedModelId,
}: {
	icon: LucideIcon;
	title: string;
	recommendations: readonly ModelRecommendation[];
	onSelectModel: (model: ModelCatalogEntry) => void;
	selectedModelId?: string | undefined;
}) {
	return (
		<div className="border-border bg-card min-w-0 rounded-xl border px-4 pt-3 pb-4">
			<div className="mb-2 flex items-center gap-2">
				<Icon className="text-primary-ink size-4" aria-hidden="true" />
				<h3 className="text-sm font-medium">{title}</h3>
			</div>
			{recommendations.length === 0 ? (
				<p className="text-muted-foreground py-4 text-sm">
					No compatible GGUF models are available in this category.
				</p>
			) : (
				<div className="divide-border divide-y">
					{recommendations.map(({ model, compatibility }) => (
						<Button
							key={model.id}
							type="button"
							variant="ghost"
							className="hover:bg-muted focus-visible:bg-muted aria-pressed:bg-muted -mx-2 h-auto w-[calc(100%+1rem)] min-w-0 justify-between gap-4 overflow-hidden rounded-lg p-2 text-left last:-mb-2"
							aria-pressed={model.id === selectedModelId}
							aria-label={`View ${model.name} details`}
							data-qa-id={`recommended-model-${model.id}`}
							onClick={() => onSelectModel(model)}
						>
							<ModelIdentity model={model} compact />
							<ModelPerformance
								compatibility={compatibility}
								hasHardware
								hasQuantizations={model.quantizations.length > 0}
								stackOnNarrow
							/>
						</Button>
					))}
				</div>
			)}
		</div>
	);
}

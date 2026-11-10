import type { LocalInferenceHardwareProfile, ModelCatalogEntry } from "../../contracts/index";
import { evaluateCatalogModel, type ModelCompatibility } from "./model-compatibility";
import { getEditorialModelScore, type EditorialModelCategory } from "./model-editorial-priority";

export interface ModelRecommendations {
	readonly coding: readonly ModelRecommendation[];
	readonly small: readonly ModelRecommendation[];
}

export interface ModelRecommendation {
	readonly model: ModelCatalogEntry;
	readonly compatibility: ModelCompatibility;
}

export interface CatalogModelEvaluation {
	readonly model: ModelCatalogEntry;
	readonly compatibility: ModelCompatibility | null;
}

export type CatalogSort = "newest" | "best-fit" | "fastest" | "parameters-desc" | "parameters-asc";

function getPublishedTimestamp(model: ModelCatalogEntry): number | null {
	if (!model.publishedAt) return null;
	const timestamp = Date.parse(model.publishedAt);
	return Number.isFinite(timestamp) ? timestamp : null;
}

function recencyScore(model: ModelCatalogEntry, nowTimestamp: number): number {
	const publishedTimestamp = getPublishedTimestamp(model);
	if (publishedTimestamp === null) return 0;

	const published = new Date(publishedTimestamp);
	const now = new Date(nowTimestamp);
	const ageInMonths =
		(now.getFullYear() - published.getFullYear()) * 12 + now.getMonth() - published.getMonth();
	return Math.max(0, 15 - ageInMonths * 0.4);
}

function modelQualityScore(
	model: ModelCatalogEntry,
	nowTimestamp: number,
	editorialCategory: EditorialModelCategory,
): number {
	const parametersBillions = model.numParameters / 1_000_000_000;
	return (
		getEditorialModelScore(model.name, editorialCategory) +
		Math.min(20, Math.log2(parametersBillions + 1) * 3.2) +
		recencyScore(model, nowTimestamp)
	);
}

function speedFactor(tokensPerSecond: number | null): number {
	const speed = tokensPerSecond ?? 0;
	if (speed >= 30) return 1;
	if (speed >= 15) return 0.9;
	if (speed >= 8) return 0.78;
	if (speed >= 4) return 0.6;
	return 0.45;
}

function recommendationScore(
	recommendation: ModelRecommendation,
	nowTimestamp: number,
	editorialCategory: EditorialModelCategory,
	usage: Readonly<Record<string, number>>,
): number {
	const { model, compatibility } = recommendation;
	const fitFactor = compatibility.status === "can-run" ? 1 : 0.6;
	return (
		modelQualityScore(model, nowTimestamp, editorialCategory) *
			fitFactor *
			speedFactor(compatibility.estimatedTokensPerSecondCenter) +
		compatibility.score * 0.15 -
		(usage[model.id] ?? 0) * 10
	);
}

const BASE_MODEL_NAME_PATTERN = /(?:^|[\s._-])base(?:$|[\s._-])/i;
const GUARD_MODEL_NAME_PATTERN = /(?:^|[\s._-])guard(?:$|[\s._-])/i;
const TEXT_TAGS = new Set([
	"chat",
	"code",
	"code-generation",
	"reasoning",
	"instruction-following",
	"text-generation",
]);
function recommendationEligible(model: ModelCatalogEntry): boolean {
	const tags = new Set(model.tags.map((tag) => tag.toLowerCase()));
	return (
		!model.capabilities.embedding &&
		model.modelType.toLowerCase() !== "sentence similarity" &&
		!tags.has("embedding") &&
		!tags.has("base-model") &&
		!tags.has("guardrail") &&
		!BASE_MODEL_NAME_PATTERN.test(model.name) &&
		!GUARD_MODEL_NAME_PATTERN.test(model.name)
	);
}

function isTextModel(model: ModelCatalogEntry): boolean {
	if (!recommendationEligible(model)) return false;
	if (model.capabilities.chat || model.modelType.toLowerCase() === "text generation") return true;
	return model.tags.some((tag) => TEXT_TAGS.has(tag.toLowerCase()));
}

function availabilityRank(compatibility: ModelCompatibility | null): number {
	if (!compatibility) return 3;
	if (compatibility.status === "can-run") return 0;
	if (compatibility.status === "tight") return 1;
	return 2;
}

function publishedTimestamp(model: ModelCatalogEntry): number | null {
	const timestamp = Date.parse(model.publishedAt ?? "");
	return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortCatalogModels(
	models: readonly ModelCatalogEntry[],
	hardware: LocalInferenceHardwareProfile | undefined,
	sort: CatalogSort = "newest",
): readonly CatalogModelEvaluation[] {
	return models
		.map((model) => ({
			model,
			compatibility: hardware ? evaluateCatalogModel(model, hardware) : null,
		}))
		.sort((left, right) => {
			if (sort === "newest") {
				const leftPublished = publishedTimestamp(left.model);
				const rightPublished = publishedTimestamp(right.model);
				if (leftPublished !== null && rightPublished !== null && leftPublished !== rightPublished) {
					return rightPublished - leftPublished;
				}
				if (leftPublished !== null && rightPublished === null) return -1;
				if (leftPublished === null && rightPublished !== null) return 1;
			} else if (sort === "best-fit") {
				const statusDifference =
					availabilityRank(left.compatibility) - availabilityRank(right.compatibility);
				if (statusDifference !== 0) return statusDifference;

				const scoreDifference =
					(right.compatibility?.score ?? 0) - (left.compatibility?.score ?? 0);
				if (scoreDifference !== 0) return scoreDifference;

				if (left.model.numParameters !== right.model.numParameters) {
					return left.model.numParameters - right.model.numParameters;
				}
			} else {
				const availabilityDifference =
					availabilityRank(left.compatibility) - availabilityRank(right.compatibility);
				if (availabilityDifference !== 0) return availabilityDifference;

				if (sort === "fastest") {
					const speedDifference =
						(right.compatibility?.estimatedTokensPerSecondCenter ?? 0) -
						(left.compatibility?.estimatedTokensPerSecondCenter ?? 0);
					if (speedDifference !== 0) return speedDifference;
				}

				if (sort === "parameters-desc" && left.model.numParameters !== right.model.numParameters) {
					return right.model.numParameters - left.model.numParameters;
				}

				if (sort === "parameters-asc" && left.model.numParameters !== right.model.numParameters) {
					return left.model.numParameters - right.model.numParameters;
				}
			}

			return left.model.name.localeCompare(right.model.name);
		});
}

function rankedRecommendations(
	models: readonly ModelCatalogEntry[],
	hardware: LocalInferenceHardwareProfile,
	predicate: (model: ModelCatalogEntry) => boolean,
	nowTimestamp: number,
	editorialCategory: EditorialModelCategory,
	usage: Readonly<Record<string, number>>,
): readonly ModelRecommendation[] {
	return models
		.filter(predicate)
		.map((model) => {
			const compatibility = evaluateCatalogModel(model, hardware);
			return compatibility ? { model, compatibility } : null;
		})
		.filter((result): result is ModelRecommendation => result !== null)
		.filter(({ compatibility }) => ["can-run", "tight"].includes(compatibility.status))
		.sort(
			(left, right) =>
				recommendationScore(right, nowTimestamp, editorialCategory, usage) -
				recommendationScore(left, nowTimestamp, editorialCategory, usage),
		)
		.slice(0, 3);
}

export function getCatalogRecommendations(
	models: readonly ModelCatalogEntry[],
	hardware: LocalInferenceHardwareProfile,
): ModelRecommendations {
	const nowTimestamp = Date.now();
	const usage: Record<string, number> = {};
	const coding = rankedRecommendations(models, hardware, isTextModel, nowTimestamp, "text", usage);
	for (const { model } of coding) usage[model.id] = (usage[model.id] ?? 0) + 1;

	const small = rankedRecommendations(
		models,
		hardware,
		(model) => recommendationEligible(model) && model.numParameters <= 4_000_000_000,
		nowTimestamp,
		"small",
		usage,
	);

	return { coding, small };
}

const ESTIMATED_MOE_ACTIVE_PARAMETER_RATIO = 0.12;

const parameterUnitMultipliers: Record<string, number> = {
	k: 1_000,
	m: 1_000_000,
	b: 1_000_000_000,
	t: 1_000_000_000_000,
};

const activeParameterNamePattern = /(?:^|[^a-z0-9])a(\d+(?:\.\d+)?)\s*([kmbt])(?:$|[^a-z0-9])/i;
const activeParameterDescriptionPattern =
	/(\d+(?:\.\d+)?)\s*([kmbt])\s+(?:active|activated)(?:\s+parameters?)?/i;
const mixtureOfExpertsPattern = /moe|mixture[\s-]+of[\s-]+experts?/i;
const expertCountPattern = /(?:^|[^a-z0-9])\d+\s*e(?:$|[^a-z0-9])/i;
const efficientGemmaParameterCounts: ReadonlyArray<readonly [RegExp, number]> = [
	[/gemma[\s._-]*(?:3n|4)[\s._-]*e2b/i, 5_000_000_000],
	[/gemma[\s._-]*(?:3n|4)[\s._-]*e4b/i, 8_000_000_000],
];

interface ActiveParameterMetadata {
	readonly name: string;
	readonly description: string;
	readonly modelType: string;
	readonly tags: readonly string[];
}

export interface ActiveParameterEstimate {
	readonly count: number;
	readonly estimated: boolean;
}

function parameterCountFromMatch(match: RegExpMatchArray | null): number | null {
	if (!match?.[1] || !match[2]) return null;

	const value = Number.parseFloat(match[1]);
	const multiplier = parameterUnitMultipliers[match[2].toLowerCase()];
	if (!Number.isFinite(value) || !multiplier) return null;

	return Math.round(value * multiplier);
}

export function marketedParameterCount(name: string): number | null {
	const efficientGemmaCount = efficientGemmaParameterCounts.find(([pattern]) =>
		pattern.test(name),
	)?.[1];
	if (efficientGemmaCount) return efficientGemmaCount;
	if (expertCountPattern.test(name)) return null;

	for (const match of name.matchAll(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*([kmbt])(?=$|[^a-z0-9])/gi)) {
		const count = parameterCountFromMatch(match);
		if (count) return count;
	}

	return null;
}

export function estimateActiveParameters(
	metadata: ActiveParameterMetadata,
	totalParameters: number,
): ActiveParameterEstimate {
	if (totalParameters <= 0) return { count: 0, estimated: false };

	const namedActiveParameterCount = parameterCountFromMatch(
		metadata.name.match(activeParameterNamePattern),
	);
	const architectureMetadata = [metadata.name, metadata.modelType, ...metadata.tags].join(" ");
	const isMixtureOfExperts =
		Boolean(namedActiveParameterCount) || mixtureOfExpertsPattern.test(architectureMetadata);
	const explicitCount =
		(isMixtureOfExperts
			? parameterCountFromMatch(metadata.description.match(activeParameterDescriptionPattern))
			: null) ?? namedActiveParameterCount;
	if (explicitCount && explicitCount <= totalParameters) {
		return { count: explicitCount, estimated: false };
	}

	if (isMixtureOfExperts) {
		return {
			count: Math.max(1, Math.round(totalParameters * ESTIMATED_MOE_ACTIVE_PARAMETER_RATIO)),
			estimated: true,
		};
	}

	return { count: totalParameters, estimated: false };
}

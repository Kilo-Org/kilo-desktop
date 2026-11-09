export type EditorialModelCategory = "text" | "small";

// Curated model order is deliberately kept as data so it can be reviewed and
// refreshed without changing the recommendation algorithm.
const editorialModelPriorities: Readonly<Record<EditorialModelCategory, readonly string[]>> = {
	text: [
		"qwen3.6-35b-a3b",
		"qwen3.8-27b",
		"minimax-m3",
		"kimi-k3",
		"agents-a1",
		"longcat-2.0",
		"gemma4-26b-a4b-it",
		"gpt-oss-20b",
		"gemma4-31b-it",
		"mistral-small-4-119b",
		"hy3",
		"glm-4.5-air",
		"qwen3-32b",
		"devstral-small-2-24b",
		"glm-5.3",
		"glm-5.2",
		"qwen3-coder-480b",
		"deepseek-r1-14b",
		"phi-4-14b",
		"qwen3-14b",
		"qwen3-8b",
		"qwen3.5-9b",
		"qwen2.5-coder-7b",
		"deepseek-r1-32b",
	],
	small: [
		"ministral-3-3b",
		"qwen3.5-4b",
		"gemma3-4b",
		"qwen3.5-2b",
		"smollm3-3b",
		"phi-4-mini-reasoning",
		"qwen3-1.7b",
		"llama3.2-3b",
		"gemma3-1b",
		"qwen3.5-0.8b",
		"qwen3-0.6b",
		"llama3.2-1b",
	],
};

function normalizeModelName(name: string): string {
	return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function matchesCuratedModelName(modelName: string, candidate: string): boolean {
	return normalizeModelName(modelName).includes(normalizeModelName(candidate));
}

export function getEditorialModelScore(
	modelName: string,
	category: EditorialModelCategory = "text",
): number {
	const priority = editorialModelPriorities[category].findIndex((candidate) =>
		matchesCuratedModelName(modelName, candidate),
	);

	return priority === -1 ? 0 : Math.max(6, 30 - priority * 3);
}

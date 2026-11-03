/** Scripted content for the sign-in showcase's self-typing model picker. */

export type ShowcaseModel = { provider: string; name: string; lab: string };

const LABS: readonly ShowcaseModel[] = [
	{ provider: "anthropic", name: "Claude", lab: "Anthropic" },
	{ provider: "openai", name: "GPT", lab: "OpenAI" },
	{ provider: "gemini", name: "Gemini", lab: "Google" },
	{ provider: "xai", name: "Grok", lab: "xAI" },
	{ provider: "mistral", name: "Mistral", lab: "Mistral AI" },
	{ provider: "deepseek", name: "DeepSeek", lab: "DeepSeek" },
];

const VARIANTS: readonly ShowcaseModel[] = [
	{ provider: "anthropic", name: "Claude Sonnet", lab: "Anthropic" },
	{ provider: "anthropic", name: "Claude Opus", lab: "Anthropic" },
	{ provider: "anthropic", name: "Claude Haiku", lab: "Anthropic" },
	{ provider: "openai", name: "GPT", lab: "OpenAI" },
	{ provider: "openai", name: "GPT mini", lab: "OpenAI" },
	{ provider: "openai", name: "GPT Codex", lab: "OpenAI" },
	{ provider: "gemini", name: "Gemini Pro", lab: "Google" },
	{ provider: "gemini", name: "Gemini Flash", lab: "Google" },
];

export const SHOWCASE_QUERIES = ["cl", "gpt", "gem"] as const;

/** The idle list is one model per lab; a query filters the variant catalog by prefix. */
export function filterShowcaseModels(query: string): readonly ShowcaseModel[] {
	if (!query) return LABS;
	const needle = query.toLowerCase();
	return VARIANTS.filter((model) => model.name.toLowerCase().startsWith(needle));
}

export type TypingFrame = { text: string; holdMs: number };

const HOLD_IDLE_MS = 1200;
const TYPE_MS = 110;
const HOLD_TYPED_MS = 1800;
const ERASE_MS = 45;

/**
 * One loop of the picker: idle, type the query, hold, backspace. The erase
 * stops one character short; the next query's idle frame is the empty field.
 */
export function typingScript(queries: readonly string[]): TypingFrame[] {
	return queries.flatMap((query) => [
		{ text: "", holdMs: HOLD_IDLE_MS },
		...Array.from({ length: query.length }, (_, index) => ({
			text: query.slice(0, index + 1),
			holdMs: index === query.length - 1 ? HOLD_TYPED_MS : TYPE_MS,
		})),
		...Array.from({ length: query.length - 1 }, (_, index) => ({
			text: query.slice(0, query.length - 1 - index),
			holdMs: ERASE_MS,
		})),
	]);
}

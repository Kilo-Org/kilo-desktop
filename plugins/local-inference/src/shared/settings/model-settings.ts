import { z } from "zod";

const FLAG_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/;
const FLAG_KEY = /^[a-z][a-z0-9-]*$/;

/** llama.cpp request fallbacks used when callers omit sampling parameters. */
export const LLAMA_CPP_SAMPLING_DEFAULTS = {
	temperature: 0.8,
	topP: 0.95,
	topK: 40,
	minP: 0.05,
	repeatPenalty: 1,
	presencePenalty: 0,
} as const;

const APP_MANAGED_FLAG_MESSAGES: Record<string, string> = {
	"models-max": "Set models kept loaded in Server settings, not as a llama.cpp flag.",
	port: "Set port in Server settings, not as a llama.cpp flag.",
};

const APP_MANAGED_FLAGS = new Set([
	"api-key",
	"hf",
	"hf-repo",
	"host",
	"m",
	"model",
	"models-dir",
	"models-max",
	"models-preset",
	"port",
]);

function reservedFlagMessage(key: string): string {
	return APP_MANAGED_FLAG_MESSAGES[key] ?? `Cannot override reserved llama.cpp flag "${key}".`;
}

export const localModelSettingsSchema = z
	.object({
		temperature: z.number().min(0).max(2).optional(),
		topP: z.number().min(0).max(1).optional(),
		topK: z.number().int().min(0).max(100).optional(),
		minP: z.number().min(0).max(1).optional(),
		repeatPenalty: z.number().min(0).max(2).optional(),
		presencePenalty: z.number().min(0).max(2).optional(),
		contextLength: z.number().int().min(256).max(1_048_576).optional(),
		maxResponseTokens: z.number().int().min(1).max(1_048_576).optional(),
		includeKiloContext: z.boolean().optional(),
		llamaFlags: z
			.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.string().trim().min(1).max(4_096))
			.optional(),
	})
	.superRefine((settings, context) => {
		for (const key of Object.keys(settings.llamaFlags ?? {})) {
			if (!APP_MANAGED_FLAGS.has(key)) continue;
			context.addIssue({
				code: "custom",
				message: reservedFlagMessage(key),
				path: ["llamaFlags", key],
			});
		}
	});

export type LocalModelSettings = z.infer<typeof localModelSettingsSchema>;

export type LlamaOverridableModelSetting =
	| "contextLength"
	| "temperature"
	| "topP"
	| "topK"
	| "minP"
	| "repeatPenalty"
	| "presencePenalty"
	| "maxResponseTokens";

const MODEL_SETTING_FLAG_ALIASES: Record<LlamaOverridableModelSetting, readonly string[]> = {
	contextLength: ["c", "ctx", "ctx-size"],
	temperature: ["temp", "temperature"],
	topP: ["top-p"],
	topK: ["top-k"],
	minP: ["min-p"],
	repeatPenalty: ["repeat-penalty"],
	presencePenalty: ["presence-penalty"],
	maxResponseTokens: ["n", "n-predict", "predict"],
};

export function hasLlamaFlagOverride(
	settings: LocalModelSettings | undefined,
	setting: LlamaOverridableModelSetting,
): boolean {
	const flags = settings?.llamaFlags;
	return MODEL_SETTING_FLAG_ALIASES[setting].some((flag) => flags?.[flag] !== undefined);
}

export type ParseLlamaFlagsResult =
	| { ok: true; flags: Record<string, string> }
	| { ok: false; error: string };

type TokenizeResult = { ok: true; tokens: string[] } | { ok: false; error: string };

function canonicalizeLlamaFlagKey(key: string): string {
	return key.trim().toLowerCase().replaceAll("_", "-");
}

export function parseLlamaFlagRow(
	rawKey: string,
	rawValue: string,
): { ok: true; key: string; value: string } | { ok: false; error: string } {
	const key = canonicalizeLlamaFlagKey(rawKey);
	const value = rawValue.trim();
	if (!key || !value) {
		return { ok: false, error: "Flag name and value are both required." };
	}
	if (!FLAG_KEY.test(key)) {
		return { ok: false, error: 'Each llama.cpp flag name must be like "n-gpu-layers".' };
	}
	if (APP_MANAGED_FLAGS.has(key)) {
		return { ok: false, error: reservedFlagMessage(key) };
	}
	return { ok: true, key, value };
}

export function llamaFlagsFromRows(
	rows: readonly { key: string; value: string }[],
): ParseLlamaFlagsResult {
	const flags: Record<string, string> = {};
	for (const row of rows) {
		const parsed = parseLlamaFlagRow(row.key, row.value);
		if (!parsed.ok) return parsed;
		if (parsed.key in flags) {
			return { ok: false, error: `llama.cpp flag "${parsed.key}" is set more than once.` };
		}
		flags[parsed.key] = parsed.value;
	}
	return { ok: true, flags };
}

function tokenizeArguments(text: string): TokenizeResult {
	const tokens: string[] = [];
	let token = "";
	let tokenStarted = false;
	let quote: '"' | "'" | undefined;
	let escaped = false;
	let comment = false;
	let lineHasArgument = false;

	const pushToken = () => {
		if (!tokenStarted) return;
		tokens.push(token);
		token = "";
		tokenStarted = false;
	};

	for (const character of text) {
		if (comment) {
			if (character === "\n") {
				comment = false;
				lineHasArgument = false;
			}
			continue;
		}
		if (escaped) {
			token += character;
			tokenStarted = true;
			lineHasArgument = true;
			escaped = false;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else if (character === "\\" && quote === '"') escaped = true;
			else token += character;
			tokenStarted = true;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			tokenStarted = true;
			lineHasArgument = true;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			tokenStarted = true;
			lineHasArgument = true;
			continue;
		}
		if (character === "#" && !tokenStarted && !lineHasArgument) {
			comment = true;
			continue;
		}
		if (/\s/.test(character)) {
			pushToken();
			if (character === "\n") lineHasArgument = false;
			continue;
		}
		token += character;
		tokenStarted = true;
		lineHasArgument = true;
	}

	if (quote) return { ok: false, error: "Extra arguments contain an unterminated quote." };
	if (escaped) return { ok: false, error: "Extra arguments end with an incomplete escape." };
	pushToken();
	return { ok: true, tokens };
}

function parseCommandLineFlags(text: string): ParseLlamaFlagsResult {
	const tokenized = tokenizeArguments(text);
	if (!tokenized.ok) return tokenized;

	const rows: { key: string; value: string }[] = [];
	for (let index = 0; index < tokenized.tokens.length; index += 1) {
		const argument = tokenized.tokens[index] ?? "";
		if (!argument.startsWith("--") || argument.length === 2) {
			return { ok: false, error: `Expected a llama.cpp flag, but found "${argument}".` };
		}

		const flag = argument.slice(2);
		const equalsIndex = flag.indexOf("=");
		if (equalsIndex >= 0) {
			rows.push({ key: flag.slice(0, equalsIndex), value: flag.slice(equalsIndex + 1) });
			continue;
		}

		const following = tokenized.tokens[index + 1];
		if (following !== undefined && !following.startsWith("--")) {
			rows.push({ key: flag, value: following });
			index += 1;
		} else {
			rows.push({ key: flag, value: "true" });
		}
	}

	return llamaFlagsFromRows(rows);
}

export function parseLlamaFlags(text: string): ParseLlamaFlagsResult {
	const firstArgumentLine = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith("#"));
	if (firstArgumentLine?.startsWith("--")) {
		return parseCommandLineFlags(text);
	}
	const rows: { key: string; value: string }[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const match = FLAG_LINE.exec(line);
		if (!match) {
			return { ok: false, error: 'Each llama.cpp flag must be in the form "name = value".' };
		}
		rows.push({ key: match[1] ?? "", value: match[2] ?? "" });
	}
	return llamaFlagsFromRows(rows);
}

export function serializeLlamaFlags(flags: Readonly<Record<string, string>>): string {
	return Object.keys(flags)
		.toSorted()
		.map((key) => {
			const value = flags[key] ?? "";
			if (value === "true") return `--${key}`;
			const serializedValue = /^[A-Za-z0-9_./:@%+,=-]+$/.test(value)
				? value
				: `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
			return `--${key} ${serializedValue}`;
		})
		.join("\n");
}

export function compactModelSettings(settings: LocalModelSettings): LocalModelSettings | undefined {
	const next: LocalModelSettings = {};
	if (settings.temperature !== undefined) next.temperature = settings.temperature;
	if (settings.topP !== undefined) next.topP = settings.topP;
	if (settings.topK !== undefined) next.topK = settings.topK;
	if (settings.minP !== undefined) next.minP = settings.minP;
	if (settings.repeatPenalty !== undefined) next.repeatPenalty = settings.repeatPenalty;
	if (settings.presencePenalty !== undefined) next.presencePenalty = settings.presencePenalty;
	if (settings.contextLength !== undefined) next.contextLength = settings.contextLength;
	if (settings.maxResponseTokens !== undefined) next.maxResponseTokens = settings.maxResponseTokens;
	if (settings.includeKiloContext) next.includeKiloContext = true;
	if (settings.llamaFlags && Object.keys(settings.llamaFlags).length > 0) {
		next.llamaFlags = { ...settings.llamaFlags };
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

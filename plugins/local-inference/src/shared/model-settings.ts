import { z } from "zod";

const FLAG_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/;
const FLAG_KEY = /^[a-z][a-z0-9-]*$/;

const RESERVED_FLAG_MESSAGES: Record<string, string> = {
	c: "Set context length in Model settings, not as a llama.cpp flag.",
	ctx: "Set context length in Model settings, not as a llama.cpp flag.",
	"ctx-size": "Set context length in Model settings, not as a llama.cpp flag.",
	"models-max": "Set max models in Server settings, not as a llama.cpp flag.",
	"n-predict": "Set maximum response length in Model settings, not as a llama.cpp flag.",
	port: "Set port in Server settings, not as a llama.cpp flag.",
	temp: "Set temperature in Model settings, not as a llama.cpp flag.",
	temperature: "Set temperature in Model settings, not as a llama.cpp flag.",
};

const RESERVED_FLAGS = new Set([
	"api-key",
	"c",
	"ctx",
	"ctx-size",
	"hf",
	"hf-repo",
	"host",
	"m",
	"model",
	"models-dir",
	"models-max",
	"models-preset",
	"n-predict",
	"port",
	"temp",
	"temperature",
]);

function reservedFlagMessage(key: string): string {
	return RESERVED_FLAG_MESSAGES[key] ?? `Cannot override reserved llama.cpp flag "${key}".`;
}

export const localModelSettingsSchema = z
	.object({
		temperature: z.number().min(0).max(2).optional(),
		contextLength: z.number().int().min(256).max(1_048_576).optional(),
		maxResponseTokens: z.number().int().min(1).max(1_048_576).optional(),
		includeKiloContext: z.boolean().optional(),
		llamaFlags: z
			.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.string().trim().min(1).max(4_096))
			.optional(),
	})
	.superRefine((settings, context) => {
		for (const key of Object.keys(settings.llamaFlags ?? {})) {
			if (!RESERVED_FLAGS.has(key)) continue;
			context.addIssue({
				code: "custom",
				message: reservedFlagMessage(key),
				path: ["llamaFlags", key],
			});
		}
	});

export type LocalModelSettings = z.infer<typeof localModelSettingsSchema>;

export type ParseLlamaFlagsResult =
	| { ok: true; flags: Record<string, string> }
	| { ok: false; error: string };

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
	if (RESERVED_FLAGS.has(key)) {
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

export function parseLlamaFlags(text: string): ParseLlamaFlagsResult {
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
		.map((key) => `${key} = ${flags[key]}`)
		.join("\n");
}

export function compactModelSettings(settings: LocalModelSettings): LocalModelSettings | undefined {
	const next: LocalModelSettings = {};
	if (settings.temperature !== undefined) next.temperature = settings.temperature;
	if (settings.contextLength !== undefined) next.contextLength = settings.contextLength;
	if (settings.maxResponseTokens !== undefined) next.maxResponseTokens = settings.maxResponseTokens;
	if (settings.includeKiloContext) next.includeKiloContext = true;
	if (settings.llamaFlags && Object.keys(settings.llamaFlags).length > 0) {
		next.llamaFlags = { ...settings.llamaFlags };
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

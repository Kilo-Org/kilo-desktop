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

const SERVER_RESERVED_FLAGS = new Set([
	"jinja",
	"models-autoload",
	"no-jinja",
	"no-models-autoload",
]);

export type ParseLlamaFlagsResult =
	| { ok: true; flags: Record<string, string> }
	| { ok: false; error: string };

function reservedFlagMessage(key: string): string {
	return RESERVED_FLAG_MESSAGES[key] ?? `Cannot override reserved llama.cpp flag "${key}".`;
}

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

export function parseServerFlagRow(
	rawKey: string,
	rawValue: string,
): { ok: true; key: string; value: string } | { ok: false; error: string } {
	const parsed = parseLlamaFlagRow(rawKey, rawValue);
	if (!parsed.ok) return parsed;
	if (SERVER_RESERVED_FLAGS.has(parsed.key)) {
		return { ok: false, error: `Cannot override reserved llama.cpp flag "${parsed.key}".` };
	}
	return parsed;
}

export function serverFlagsFromRows(
	rows: readonly { key: string; value: string }[],
): ParseLlamaFlagsResult {
	const result = llamaFlagsFromRows(rows);
	if (!result.ok) return result;
	for (const key of Object.keys(result.flags)) {
		if (SERVER_RESERVED_FLAGS.has(key)) {
			return { ok: false, error: `Cannot override reserved llama.cpp flag "${key}".` };
		}
	}
	return result;
}

export type ParseResult = { ok: true; value?: number } | { ok: false; error: string };

function parseInteger(raw: string, min: number, max: number, error: string): ParseResult {
	const text = raw.trim();
	if (!text) return { ok: true };
	const value = Number(text);
	if (!Number.isInteger(value) || value < min || value > max) {
		return { ok: false, error };
	}
	return { ok: true, value };
}

export function parsePort(raw: string): ParseResult {
	return parseInteger(raw, 1, 65_535, "Port must be an integer from 1 to 65535.");
}

export function parseMaxModels(raw: string): ParseResult {
	return parseInteger(raw, 1, 64, "Max models must be an integer from 1 to 64.");
}

export function parseContextLength(raw: string): ParseResult {
	return parseInteger(
		raw,
		256,
		1_048_576,
		"Context length must be an integer from 256 to 1048576.",
	);
}

export function parseMaxResponseTokens(raw: string): ParseResult {
	return parseInteger(
		raw,
		1,
		1_048_576,
		"Maximum response length must be an integer from 1 to 1048576.",
	);
}

export function clampTemperature(value: number): number {
	return Math.min(2, Math.max(0, Math.round(value * 10) / 10));
}

export function temperatureFromSlider(value: number | readonly number[]): number | undefined {
	const next = Array.isArray(value) ? value[0] : value;
	return typeof next === "number" && Number.isFinite(next) ? clampTemperature(next) : undefined;
}

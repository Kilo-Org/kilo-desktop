import { z } from "zod";

import { llamaFlagsFromRows, parseLlamaFlagRow } from "./model-settings.js";

const FLAG_KEY = /^[a-z][a-z0-9-]*$/;

const SERVER_RESERVED_FLAGS = new Set([
	"jinja",
	"models-autoload",
	"no-jinja",
	"no-models-autoload",
]);

function serverReservedMessage(key: string): string {
	return `Cannot override reserved llama.cpp flag "${key}".`;
}

export function parseServerFlagRow(
	rawKey: string,
	rawValue: string,
): { ok: true; key: string; value: string } | { ok: false; error: string } {
	const parsed = parseLlamaFlagRow(rawKey, rawValue);
	if (!parsed.ok) return parsed;
	if (SERVER_RESERVED_FLAGS.has(parsed.key)) {
		return { ok: false, error: serverReservedMessage(parsed.key) };
	}
	return parsed;
}

export function serverFlagsFromRows(
	rows: readonly { key: string; value: string }[],
): ReturnType<typeof llamaFlagsFromRows> {
	const result = llamaFlagsFromRows(rows);
	if (!result.ok) return result;
	for (const key of Object.keys(result.flags)) {
		if (SERVER_RESERVED_FLAGS.has(key)) {
			return { ok: false, error: serverReservedMessage(key) };
		}
	}
	return result;
}

export const LOOPBACK_HOST = "127.0.0.1";
export const LAN_BIND_HOST = "0.0.0.0";

export const localModelLoadModeSchema = z.enum(["one", "all"]);
export type LocalModelLoadMode = z.infer<typeof localModelLoadModeSchema>;

export const localServerSettingsSchema = z
	.object({
		port: z.number().int().min(1).max(65_535).optional(),
		modelLoadMode: localModelLoadModeSchema.optional(),
		serveOnLocalNetwork: z.boolean().optional(),
		llamaFlags: z
			.record(z.string().regex(FLAG_KEY), z.string().trim().min(1).max(4_096))
			.optional(),
	})
	.strict()
	.superRefine((settings, context) => {
		for (const [key, value] of Object.entries(settings.llamaFlags ?? {})) {
			const parsed = parseServerFlagRow(key, value);
			if (parsed.ok) continue;
			context.addIssue({
				code: "custom",
				message: parsed.error,
				path: ["llamaFlags", key],
			});
		}
	});

export type LocalServerSettings = z.infer<typeof localServerSettingsSchema>;

export function compactServerSettings(
	settings: LocalServerSettings,
): LocalServerSettings | undefined {
	const next: LocalServerSettings = {};
	if (settings.port !== undefined) next.port = settings.port;
	if (settings.modelLoadMode === "all") next.modelLoadMode = "all";
	if (settings.serveOnLocalNetwork) next.serveOnLocalNetwork = true;
	if (settings.llamaFlags && Object.keys(settings.llamaFlags).length > 0) {
		next.llamaFlags = Object.fromEntries(
			Object.keys(settings.llamaFlags)
				.toSorted()
				.map((key) => [key, settings.llamaFlags?.[key] ?? ""]),
		);
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function routerMaxModels(
	modelCount: number,
	modelLoadMode: LocalModelLoadMode = "one",
): number {
	return modelLoadMode === "all" ? modelCount : 1;
}

export function proxyBindHost(serveOnLocalNetwork?: boolean): string {
	return serveOnLocalNetwork ? LAN_BIND_HOST : LOOPBACK_HOST;
}

export function renderRouterArgs(input: {
	readonly port: number;
	readonly apiKey: string;
	readonly presetPath: string;
	readonly modelCount: number;
	readonly settings?: LocalServerSettings;
}): string[] {
	const flags = input.settings?.llamaFlags ?? {};
	const args = [
		"--host",
		LOOPBACK_HOST,
		"--port",
		String(input.port),
		"--api-key",
		input.apiKey,
		"--models-preset",
		input.presetPath,
		"--models-max",
		String(routerMaxModels(input.modelCount, input.settings?.modelLoadMode)),
		"--no-models-autoload",
		"--jinja",
	];
	for (const key of Object.keys(flags).toSorted()) {
		args.push(`--${key}`, flags[key] ?? "");
	}
	return args;
}

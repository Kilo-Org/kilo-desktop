import type { SettingsValue } from "../server-client";
import type { KiloGlobalConfig } from "./kilo-models-client";

/**
 * The models area reads and patches the user's config in v1 keys
 * (`provider.<id>` with `npm`, `options.baseURL`, `options.headers`, and
 * models' `reasoning`, `modalities`, `limit`; `model` as `<provider>/<model>`),
 * so `custom-ai-provider.ts` stays as in v1. This converts those keys to and
 * from v2's (`providers.<id>` with `package`, `settings.baseURL`, `headers`,
 * and models' `capabilities.reasoning`, `capabilities.input/output`, `limit`),
 * following v2's own v1 migration. Only the keys custom AI providers use are
 * converted; `null` (delete) passes through at the same place.
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function defined(entries: Record<string, unknown>): Json {
	return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

/** v2's model selection (`"p/m"`, `"p/m#variant"` or `{ providerID, model }`) as v1's `"p/m"`. */
function v1ModelKey(selection: unknown): string | undefined {
	if (typeof selection === "string") return selection.split("#")[0];
	if (
		isRecord(selection) &&
		typeof selection.providerID === "string" &&
		typeof selection.model === "string"
	) {
		return `${selection.providerID}/${selection.model}`;
	}
	return undefined;
}

function v1Model(model: unknown): unknown {
	if (!isRecord(model)) return model;
	const capabilities = isRecord(model.capabilities) ? model.capabilities : {};
	const reasoning = isRecord(capabilities.reasoning) && capabilities.reasoning.supported === true;
	const modalities = defined({ input: capabilities.input, output: capabilities.output });
	return defined({
		name: model.name,
		reasoning: reasoning ? true : undefined,
		modalities: Object.keys(modalities).length > 0 ? modalities : undefined,
		limit: model.limit,
	});
}

function v1Provider(entry: unknown): unknown {
	if (!isRecord(entry)) return entry;
	const settings = isRecord(entry.settings) ? entry.settings : {};
	const options = defined({ baseURL: settings.baseURL, headers: entry.headers });
	return defined({
		npm: entry.package,
		name: entry.name,
		options: Object.keys(options).length > 0 ? options : undefined,
		models: isRecord(entry.models)
			? Object.fromEntries(Object.entries(entry.models).map(([id, model]) => [id, v1Model(model)]))
			: undefined,
	});
}

/** The v2 global config document in the v1 keys the models area reads. */
export function toV1GlobalConfig(document: Readonly<Record<string, unknown>>): KiloGlobalConfig {
	const model = v1ModelKey(document.model);
	return {
		...(isRecord(document.providers)
			? {
					provider: Object.fromEntries(
						Object.entries(document.providers).map(([id, entry]) => [id, v1Provider(entry)]),
					),
				}
			: {}),
		...(model ? { model } : {}),
	};
}

function v2ModelPatch(model: unknown): unknown {
	if (!isRecord(model)) return model;
	const modalities = model.modalities;
	const capabilities = defined({
		reasoning:
			model.reasoning === undefined
				? undefined
				: model.reasoning === null
					? null
					: { supported: true },
		input: modalities === null ? null : isRecord(modalities) ? modalities.input : undefined,
		output: modalities === null ? null : isRecord(modalities) ? modalities.output : undefined,
	});
	return defined({
		name: model.name,
		capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined,
		limit: model.limit,
	});
}

function v2ProviderPatch(entry: unknown): unknown {
	if (!isRecord(entry)) return entry;
	const options = entry.options;
	return defined({
		package: entry.npm,
		name: entry.name,
		settings:
			options === null
				? null
				: isRecord(options)
					? defined({ baseURL: options.baseURL })
					: undefined,
		headers: options === null ? null : isRecord(options) ? options.headers : undefined,
		models: isRecord(entry.models)
			? Object.fromEntries(
					Object.entries(entry.models).map(([id, model]) => [id, v2ModelPatch(model)]),
				)
			: entry.models,
	});
}

/** A v1-keyed config patch as the `set` of a `kilocode.settings` write. */
export function toV2SettingsPatch(patch: KiloGlobalConfig): Record<string, SettingsValue> {
	return defined({
		providers: patch.provider
			? Object.fromEntries(
					Object.entries(patch.provider).map(([id, entry]) => [id, v2ProviderPatch(entry)]),
				)
			: undefined,
		model: patch.model,
	}) as Record<string, SettingsValue>;
}

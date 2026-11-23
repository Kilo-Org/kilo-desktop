/**
 * Kilo v1-shaped config entries (what Desktop's features and plugin
 * contributions describe) as Kilo v2 config entries, following kilocode's
 * own v1→v2 migration (`packages/core/src/v1/config/migrate.ts`). A field v2
 * already names passes through; a field v2 has no place for is reported in
 * `dropped` rather than written, since v2 ignores unknown nested keys silently.
 */

type Json = Record<string, unknown>;

export type V2PermissionEffect = "allow" | "ask" | "deny";

export interface V2PermissionRule {
	readonly action: string;
	readonly resource: string;
	readonly effect: V2PermissionEffect;
}

export interface V2Translation {
	readonly entry: Json;
	/** Dotted paths of input fields v2 has no place for. */
	readonly dropped: readonly string[];
}

function isRecord(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact(record: Json): Json {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function nonEmpty(record: Json): Json | undefined {
	const result = compact(record);
	return Object.keys(result).length > 0 ? result : undefined;
}

/** Copies `names` from `input`, as v2 takes them unchanged. */
function pick(input: Json, names: readonly string[]): Json {
	return compact(Object.fromEntries(names.map((name) => [name, input[name]])));
}

function unknownKeys(input: Json, known: ReadonlySet<string>, prefix = ""): string[] {
	return Object.keys(input)
		.filter((key) => !known.has(key))
		.map((key) => `${prefix}${key}`);
}

/** v1 permission/tool keys under their v2 tool action names (kilocode `normalizeAction`). */
export function normalizeV2Action(action: string): string {
	if (action === "write" || action === "patch" || action === "apply_patch") return "edit";
	if (action === "task") return "subagent";
	if (action === "bash") return "shell";
	return action;
}

export function toV2PermissionRule(tool: string, effect: V2PermissionEffect): V2PermissionRule {
	return { action: normalizeV2Action(tool), resource: "*", effect };
}

function isEffect(value: unknown): value is V2PermissionEffect {
	return value === "allow" || value === "ask" || value === "deny";
}

/** A v1 `permission` value (`"allow"`, `{ tool: effect }` or `{ tool: { pattern: effect } }`) as v2 rules. */
function permissionRules(value: unknown): V2PermissionRule[] | undefined {
	if (isEffect(value)) return [{ action: "*", resource: "*", effect: value }];
	if (!isRecord(value)) return undefined;
	return Object.entries(value).flatMap(([tool, rule]): V2PermissionRule[] => {
		const action = normalizeV2Action(tool);
		if (isEffect(rule)) return [{ action, resource: "*", effect: rule }];
		if (!isRecord(rule)) return [];
		return Object.entries(rule).flatMap(([resource, effect]) =>
			isEffect(effect) ? [{ action, resource, effect }] : [],
		);
	});
}

/** Retired v1 provider ids under their v2 names (kilocode `providerID`). */
function v2ProviderId(id: string): string {
	if (id === "azure-cognitive-services") return "azure";
	if (id === "google-vertex-anthropic") return "google-vertex";
	return id;
}

/** `provider/model[#variant]` as v2's explicit model selection, or undefined when it isn't one. */
function modelSelection(model: unknown, variant: unknown): Json | undefined {
	if (typeof model !== "string") return undefined;
	const match = /^([^/#]+)\/([^#]+)(?:#([^#]+))?$/u.exec(model);
	if (!match) return undefined;
	const [, providerID, id, inline] = match;
	const selected = inline ?? (typeof variant === "string" && variant ? variant : undefined);
	return compact({
		providerID: v2ProviderId(providerID!),
		model: id,
		variant: selected && !selected.includes("#") ? selected : undefined,
	});
}

const MCP_KNOWN = new Set([
	"type",
	"command",
	"cwd",
	"environment",
	"url",
	"headers",
	"oauth",
	"enabled",
	"disabled",
	"codemode",
	"timeout",
	"protocol",
	"pool",
]);

function mcpOAuth(oauth: unknown): unknown {
	if (!isRecord(oauth)) return oauth;
	return compact({
		client_id: oauth.clientId ?? oauth.client_id,
		client_secret: oauth.clientSecret ?? oauth.client_secret,
		scope: oauth.scope,
		callback_port: oauth.callbackPort ?? oauth.callback_port,
		redirect_uri: oauth.redirectUri ?? oauth.redirect_uri,
		auth_server_metadata_url: oauth.auth_server_metadata_url,
	});
}

/** A v1 `mcp.<name>` entry as v2's `mcp.servers.<name>`. */
export function toV2McpServer(input: Readonly<Json>): V2Translation {
	const timeout = input.timeout;
	return {
		entry: compact({
			...pick(input, ["type", "command", "cwd", "environment", "url", "headers"]),
			oauth: mcpOAuth(input.oauth),
			disabled: typeof input.enabled === "boolean" ? !input.enabled : input.disabled,
			codemode: input.codemode,
			timeout:
				typeof timeout === "number"
					? { startup: timeout, catalog: timeout, execution: timeout }
					: timeout,
			protocol: input.protocol,
			pool: input.pool,
		}),
		dropped: unknownKeys(input, MCP_KNOWN),
	};
}

/** Model options an OpenAI-compatible provider reads itself; v1 sent the rest in the request body. */
const COMPATIBLE_MODEL_SETTINGS = new Set([
	"apiKey",
	"baseURL",
	"headers",
	"body",
	"extraBody",
	"timeout",
	"chunkTimeout",
	"headerTimeout",
	"disabled",
	"reasoningEffort",
	"textVerbosity",
	"user",
	"strictJsonSchema",
]);

function splitModelOptions(
	options: Json,
	compatible: boolean,
): { settings: Json | undefined; body?: Json | undefined } {
	if (!compatible) return { settings: { ...options } };
	const entries = Object.entries(options);
	return {
		settings: nonEmpty(
			Object.fromEntries(entries.filter(([key]) => COMPATIBLE_MODEL_SETTINGS.has(key))),
		),
		body: nonEmpty(
			Object.fromEntries(entries.filter(([key]) => !COMPATIBLE_MODEL_SETTINGS.has(key))),
		),
	};
}

const MODEL_KNOWN = new Set([
	"id",
	"name",
	"family",
	"modalities",
	"tool_call",
	"temperature",
	"reasoning",
	"limit",
	"cost",
	"status",
	"headers",
	"options",
	"provider",
	// v2's own model fields
	"modelID",
	"type",
	"releaseDate",
	"compatibility",
	"package",
	"settings",
	"body",
	"capabilities",
	"disabled",
]);

function int(value: unknown): number | undefined {
	return typeof value === "number" ? Math.trunc(value) : undefined;
}

function modelCost(cost: unknown): unknown {
	if (!isRecord(cost)) return cost;
	if (!("cache_read" in cost) && !("cache_write" in cost) && "cache" in cost) return cost;
	return [
		compact({
			input: cost.input,
			output: cost.output,
			cache: nonEmpty({ read: cost.cache_read, write: cost.cache_write }),
		}),
	];
}

function toV2Model(
	input: Json,
	providerPackage: unknown,
	prefix: string,
): { entry: Json; dropped: string[] } {
	const modalities = isRecord(input.modalities) ? input.modalities : {};
	const provider = isRecord(input.provider) ? input.provider : {};
	const compatible = (provider.npm ?? providerPackage) === "@ai-sdk/openai-compatible";
	const options = isRecord(input.options)
		? splitModelOptions(input.options, compatible)
		: { settings: undefined, body: undefined };
	const settings = nonEmpty({
		...(isRecord(input.settings) ? input.settings : {}),
		...options.settings,
		baseURL: provider.api,
	});
	const capabilities = nonEmpty({
		...(isRecord(input.capabilities) ? input.capabilities : {}),
		tools: input.tool_call,
		temperature: input.temperature,
		input: modalities.input,
		output: modalities.output,
		reasoning: typeof input.reasoning === "boolean" ? { supported: input.reasoning } : undefined,
	});
	const limit = isRecord(input.limit)
		? compact({
				context: int(input.limit.context),
				input: int(input.limit.input),
				output: int(input.limit.output),
			})
		: undefined;
	return {
		entry: compact({
			modelID: input.id ?? input.modelID,
			...pick(input, ["type", "family", "name", "releaseDate", "compatibility", "headers"]),
			package: provider.npm ?? input.package,
			settings,
			body: nonEmpty({ ...(isRecord(input.body) ? input.body : {}), ...options.body }),
			capabilities,
			cost: modelCost(input.cost),
			disabled: input.status === "deprecated" ? true : input.disabled,
			limit,
		}),
		dropped: unknownKeys(input, MODEL_KNOWN, prefix),
	};
}

const PROVIDER_KNOWN = new Set([
	"name",
	"env",
	"npm",
	"api",
	"options",
	"models",
	// v2's own provider fields
	"canonical",
	"package",
	"compatibility",
	"settings",
	"headers",
	"body",
]);

/** A v1 `provider.<id>` entry as v2's `providers.<id>`. */
export function toV2Provider(input: Readonly<Json>): V2Translation {
	const dropped = unknownKeys(input, PROVIDER_KNOWN);
	const { headers, body, setCacheKey, ...settings } = isRecord(input.options)
		? input.options
		: ({} as Json);
	const providerPackage = input.npm ?? input.package;
	const models = isRecord(input.models)
		? Object.fromEntries(
				Object.entries(input.models).map(([id, model]) => {
					const translated = toV2Model(
						isRecord(model) ? model : {},
						providerPackage,
						`models.${id}.`,
					);
					dropped.push(...translated.dropped);
					return [id, translated.entry];
				}),
			)
		: undefined;
	return {
		entry: compact({
			...pick(input, ["canonical", "name", "env"]),
			package: providerPackage,
			compatibility:
				typeof setCacheKey === "boolean"
					? {
							...(isRecord(input.compatibility) ? input.compatibility : {}),
							supportsPromptCacheKey: setCacheKey,
						}
					: input.compatibility,
			settings: nonEmpty({
				...(isRecord(input.settings) ? input.settings : {}),
				...settings,
				...(typeof input.api === "string" && !settings.baseURL ? { baseURL: input.api } : {}),
			}),
			headers: isRecord(headers)
				? { ...(isRecord(input.headers) ? input.headers : {}), ...headers }
				: input.headers,
			body: isRecord(body) ? { ...(isRecord(input.body) ? input.body : {}), ...body } : input.body,
			models,
		}),
		dropped,
	};
}

const AGENT_KNOWN = new Set([
	"model",
	"variant",
	"temperature",
	"top_p",
	"options",
	"prompt",
	"description",
	"mode",
	"hidden",
	"color",
	"steps",
	"maxSteps",
	"disable",
	"permission",
	// v2's own agent fields
	"system",
	"request",
	"disabled",
	"permissions",
]);

/** A v1 `agent.<id>` entry as v2's `agents.<id>`. */
export function toV2Agent(input: Readonly<Json>): V2Translation {
	const dropped = unknownKeys(input, AGENT_KNOWN);
	const model = modelSelection(input.model, input.variant);
	if (input.model !== undefined && model === undefined && !isRecord(input.model))
		dropped.push("model");
	const request = isRecord(input.request) ? input.request : {};
	const body = nonEmpty({
		...(isRecord(request.body) ? request.body : {}),
		...(isRecord(input.options) ? input.options : {}),
		temperature: input.temperature,
		top_p: input.top_p,
	});
	const color = typeof input.color === "string" ? input.color : undefined;
	return {
		entry: compact({
			model: model ?? (isRecord(input.model) ? input.model : undefined),
			request: nonEmpty({ ...request, body }),
			system: input.prompt ?? input.system,
			description: input.description,
			mode: input.mode,
			hidden: input.hidden,
			// v1 theme color names have no v2 equivalent; kilocode migrates them to grey.
			color: color === undefined ? undefined : color.startsWith("#") ? color : "#aaaaaa",
			steps: input.steps ?? input.maxSteps,
			disabled: input.disable ?? input.disabled,
			permissions: permissionRules(input.permission) ?? input.permissions,
		}),
		dropped,
	};
}

const COMMAND_KNOWN = new Set([
	"template",
	"description",
	"agent",
	"model",
	"variant",
	"subtask",
	"subagent",
]);

/** A v1 `command.<id>` entry as v2's `commands.<id>`. */
export function toV2Command(input: Readonly<Json>): V2Translation {
	const dropped = unknownKeys(input, COMMAND_KNOWN);
	const model = modelSelection(input.model, input.variant);
	if (input.model !== undefined && model === undefined && !isRecord(input.model))
		dropped.push("model");
	return {
		entry: compact({
			...pick(input, ["template", "description", "agent"]),
			model: model ?? (isRecord(input.model) ? input.model : undefined),
			subagent: input.subtask ?? input.subagent,
		}),
		dropped,
	};
}

/**
 * The boundary between kilo.core's shared contracts, which still describe
 * Kilo entries in Kilo v1's shape, and Kilo v2. Each contract that feeds the
 * v2 line has one adapter here, named after it; everything past these speaks
 * v2 only. They go once the contracts move to Kilo v2 (migration plan step 29).
 */

import type {
	AgentExtensionConfig,
	AiProviderConfig,
	McpServerEntry,
	ModelRef,
	PermissionRule,
} from "../../contracts";
import type {
	KiloAgent,
	KiloCommand,
	KiloMcpServer,
	KiloModelSelection,
	KiloPermissionRule,
	KiloProvider,
} from "./kilo-config-types";

type Json = Record<string, unknown>;

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

/** A contract `ModelRef` as the model selection v2 agents and commands take. */
function modelSelectionFromContract(model: ModelRef): KiloModelSelection {
	return { providerID: model.aiProviderId, model: model.modelId };
}

/**
 * A `kilo.core/mcp-server` source's `McpServerEntry` (Kilo v1's `mcp.<name>`)
 * as v2's `mcp.servers.<name>`, until the contract moves to Kilo v2
 * (migration plan step 29).
 */
export function mcpServerFromContract(entry: McpServerEntry): KiloMcpServer {
	const oauth = entry.oauth;
	const timeout = entry.timeout;
	return compact({
		type: entry.type,
		command: entry.command,
		cwd: entry.cwd,
		environment: entry.environment,
		url: entry.url,
		headers: entry.headers,
		oauth: isRecord(oauth)
			? compact({
					client_id: oauth.clientId,
					client_secret: oauth.clientSecret,
					scope: oauth.scope,
					callback_port: oauth.callbackPort,
					redirect_uri: oauth.redirectUri,
				})
			: oauth,
		disabled: typeof entry.enabled === "boolean" ? !entry.enabled : undefined,
		timeout:
			typeof timeout === "number"
				? { startup: timeout, catalog: timeout, execution: timeout }
				: undefined,
	}) as KiloMcpServer;
}

function modelFromContract(model: Json): Json {
	const modalities = isRecord(model.modalities) ? model.modalities : {};
	const cost = isRecord(model.cost) ? model.cost : undefined;
	return compact({
		name: model.name,
		capabilities: nonEmpty({
			tools: model.tool_call,
			temperature: model.temperature,
			input: modalities.input,
			output: modalities.output,
			reasoning: typeof model.reasoning === "boolean" ? { supported: model.reasoning } : undefined,
		}),
		limit: model.limit,
		cost: cost
			? compact({
					input: cost.input,
					output: cost.output,
					cache: nonEmpty({ read: cost.cache_read, write: cost.cache_write }),
				})
			: undefined,
	});
}

/**
 * A `kilo.core/ai-provider` contribution's `AiProviderConfig.entry` (Kilo
 * v1's `provider.<id>`) as v2's `providers.<id>`, until the contract moves to
 * Kilo v2 (migration plan step 29).
 */
export function providerEntryFromContract(entry: AiProviderConfig["entry"]): KiloProvider {
	const { headers, ...settings } = isRecord(entry.options) ? entry.options : ({} as Json);
	return compact({
		name: entry.name,
		env: entry.env,
		package: entry.npm,
		settings: nonEmpty({
			...settings,
			...(typeof entry.api === "string" && settings.baseURL === undefined
				? { baseURL: entry.api }
				: {}),
		}),
		headers: isRecord(headers) ? headers : undefined,
		models: isRecord(entry.models)
			? Object.fromEntries(
					Object.entries(entry.models).map(([id, model]) => [
						id,
						modelFromContract(isRecord(model) ? model : {}),
					]),
				)
			: undefined,
	}) as KiloProvider;
}

/**
 * A `kilo.core/agent-extension` agent (whose system prompt the contract
 * calls `prompt`) as v2's `agents.<id>`, until the contract moves to Kilo v2
 * (migration plan step 29).
 */
export function agentFromContract(
	metadata: Extract<AgentExtensionConfig, { type: "agent" }>,
): KiloAgent {
	return {
		description: metadata.description,
		system: metadata.prompt,
		mode: metadata.mode,
		...(metadata.model ? { model: modelSelectionFromContract(metadata.model) } : {}),
	};
}

/**
 * A `kilo.core/agent-extension` command (which the contract runs as a
 * subagent with `subtask`) as v2's `commands.<id>`, until the contract moves
 * to Kilo v2 (migration plan step 29).
 */
export function commandFromContract(
	metadata: Extract<AgentExtensionConfig, { type: "command" }>,
): KiloCommand {
	return {
		template: metadata.template,
		...(metadata.description !== undefined ? { description: metadata.description } : {}),
		...(metadata.agent !== undefined ? { agent: metadata.agent } : {}),
		...(metadata.model ? { model: modelSelectionFromContract(metadata.model) } : {}),
		...(metadata.subtask !== undefined ? { subagent: metadata.subtask } : {}),
	};
}

/**
 * Contract `PermissionRule`s (`{ permission, pattern, action }`, as
 * `kilo.core/chat-config` and the contract's tool rules give them) as v2's
 * `{ action, resource, effect }`, until the contract moves to Kilo v2
 * (migration plan step 29).
 */
export function permissionRulesFromContract(
	rules: readonly PermissionRule[],
): KiloPermissionRule[] {
	return rules.map((rule) => ({
		action: rule.permission,
		resource: rule.pattern,
		effect: rule.action,
	}));
}

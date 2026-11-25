import type { AgentInfo, McpServer, SkillInfo } from "@kilocode/client";
import type {
	Definition,
	Installed,
	Item,
	Kind,
	Parameter,
	Scope,
} from "@opencode/schema/kilocode/marketplace";
import type { Rpc } from "@opencode/schema/rpc";

import {
	marketplaceItemSchema,
	type MarketplaceItem,
	type MarketplaceItemRef,
	type MarketplaceMcpStatus,
	type MarketplaceType,
	type McpMarketplaceItem,
} from "../contracts/index";

/**
 * Kilo v2's Marketplace as kilo.marketplace's contract items, MCP statuses and
 * installs, for its snapshot, install review and settings page.
 *
 * v2 serves the catalog, installs and removals through the
 * `kilocode.marketplace` RPC (one list per kind; installs keyed by registry,
 * kind and id; only managed installs are recorded), agents and skills through
 * `agent.list`/`skill.list` with `kilocode.agent`/`kilocode.skill` for what a
 * removal may delete, MCP status through `mcp.list`, and MCP sign-in through
 * the server's integration OAuth.
 *
 * v2's catalog hides MCP configuration templates; its `preview` renders the
 * entry an install will write. Each MCP option's preview, with every
 * parameter left as its `{{key}}` placeholder (secrets come back redacted),
 * becomes the contract item's `content`, so the install dialog shows what v2 writes
 * and the reviewed-content check binds to it. Previews are local and cheap.
 *
 * Items and MCP statuses leave through the shared, v1-shaped marketplace
 * contract, converted in exactly two adapters here: `toContractItem` and
 * `toMcpStatus` (the contract goes v2 in step 29 of the migration plan).
 */

type Methods = typeof Definition.methods;
export type ListOutput = Rpc.Output<Methods["list"]["output"]>;
export type PreviewInput = Rpc.Input<Methods["preview"]["input"]>;
export type Preview = Rpc.Output<Methods["preview"]["output"]>;
export type InstallInput = Rpc.Input<Methods["install"]["input"]>;
export type UninstallInput = Rpc.Input<Methods["uninstall"]["input"]>;
export type { Installed, Item, Kind, Parameter, Scope };

/** The calls the marketplace makes on Kilo v2, each in `directory`'s location. */
export interface V2MarketplaceApi {
	list(kind: Kind, directory: string): Promise<ListOutput>;
	installed(directory: string): Promise<readonly Installed[]>;
	preview(input: PreviewInput, directory: string): Promise<Preview>;
	install(input: InstallInput, directory: string): Promise<Installed>;
	uninstall(input: UninstallInput, directory: string): Promise<void>;
	agents(
		directory: string,
	): Promise<ReadonlyArray<Pick<AgentInfo, "id" | "name" | "description" | "hidden">>>;
	removableAgents(directory: string): Promise<ReadonlyArray<{ name: string; scope: Scope }>>;
	removeAgent(name: string, scope: Scope, directory: string): Promise<void>;
	skills(
		directory: string,
	): Promise<ReadonlyArray<Pick<SkillInfo, "id" | "name" | "description" | "path" | "content">>>;
	removableSkills(directory: string): Promise<readonly string[]>;
	removeSkill(path: string, directory: string): Promise<void>;
	mcpServers(directory: string): Promise<readonly McpServer[]>;
	oauthMethods(integrationID: string, directory: string): Promise<readonly string[]>;
	oauthConnect(
		integrationID: string,
		methodID: string,
		directory: string,
	): Promise<{ attemptID: string; url: string; expires: number }>;
	oauthStatus(
		integrationID: string,
		attemptID: string,
		directory: string,
	): Promise<{ status: "pending" | "complete" | "failed" | "expired"; message?: string }>;
}

/** A failure Kilo reported (an RPC error type and its message). */
export class MarketplaceBackendError extends Error {}

const CATALOG_FALLBACK_URL = "https://github.com/Kilo-Org/kilo-marketplace";
const KINDS = ["agent", "skill", "mcp"] as const satisfies readonly Kind[];
type ContractKind = (typeof KINDS)[number];

export type MarketplaceList = {
	items: MarketplaceItem[];
	project: MarketplaceItemRef[];
	global: MarketplaceItemRef[];
	errors: string[];
};

const isHttpUrl = (value: string | undefined): value is string => {
	try {
		return value !== undefined && /^https?:$/.test(new URL(value).protocol);
	} catch {
		return false;
	}
};

const placeholders = (parameters: readonly Parameter[]) =>
	Object.fromEntries(parameters.map((parameter) => [parameter.key, `{{${parameter.key}}}`]));

/**
 * A v2 MCP status as the shared contract's (step 29 makes the contract v2).
 * The contract has no `pending`, so a server still connecting has no status
 * yet (`undefined`) rather than a made-up failure, and its `needs_auth` carries
 * no reason, so v2's `needs_auth.error` is dropped. v2 never reports the
 * contract's `needs_client_registration`.
 */
export function toMcpStatus(status: McpServer["status"]): MarketplaceMcpStatus | undefined {
	switch (status.status) {
		case "connected":
		case "disabled":
			return { status: status.status };
		case "needs_auth":
			return { status: "needs_auth" };
		case "failed":
			return { status: "failed", error: status.error };
		case "pending":
			return undefined;
	}
}

/** Kilo's MCP servers in a location: every configured name, and the statuses the contract can show. */
export type McpServerStatuses = {
	servers: string[];
	statuses: Record<string, MarketplaceMcpStatus>;
};

/**
 * A v2 catalog item as the shared contract's (step 29 makes the contract v2);
 * MCP items get their rendered `content` from `mcpContent`. It drops what the
 * contract has no place for: `plugin` items; `registry` (kept by the caller
 * for installs); `tags`; each option's `description`; each parameter's
 * `secret` (the web reads it back from the preview's redaction); an agent's
 * `model`, `color`, `steps`, `hidden` and `permissions`; a skill without an
 * http(s) source; an agent's non-http(s) `url`. An MCP item without an
 * http(s) `url` links to the catalog, and a missing category becomes `other`.
 */
function toContractItem(
	item: Item & { kind: ContractKind },
	mcpContent: McpMarketplaceItem["content"] | undefined,
): MarketplaceItem | undefined {
	const base = {
		id: item.id,
		name: item.name,
		description: item.description,
		category: item.category || "other",
		...(item.author ? { author: item.author } : {}),
		...(item.prerequisites.length > 0 ? { prerequisites: [...item.prerequisites] } : {}),
	};
	const candidate =
		item.kind === "agent"
			? {
					...base,
					...(isHttpUrl(item.url) ? { authorUrl: item.url } : {}),
					type: "agent",
					content: {
						mode: item.agent?.mode ?? "primary",
						description: item.agent?.description ?? item.description,
						prompt: item.agent?.system ?? "",
					},
				}
			: item.kind === "skill"
				? isHttpUrl(item.url)
					? { ...base, type: "skill", content: item.url, githubUrl: item.url }
					: undefined
				: {
						...base,
						type: "mcp",
						url: isHttpUrl(item.url) ? item.url : CATALOG_FALLBACK_URL,
						...(item.parameters.length > 0
							? { parameters: contractParameters(item.parameters) }
							: {}),
						content: mcpContent,
					};
	const parsed = marketplaceItemSchema.safeParse(candidate);
	return parsed.success ? parsed.data : undefined;
}

const contractParameters = (parameters: readonly Parameter[]) =>
	parameters.map(({ key, name, placeholder, optional }) => ({
		key,
		name,
		optional,
		...(placeholder ? { placeholder } : {}),
	}));

const isContractKind = (item: Item): item is Item & { kind: ContractKind } =>
	(KINDS as readonly Kind[]).includes(item.kind);

export class KiloV2Marketplace {
	readonly #api: V2MarketplaceApi;
	/** Registries of the items the last `list` saw, by `type:id`. */
	readonly #registries = new Map<string, string>();

	constructor(api: V2MarketplaceApi) {
		this.#api = api;
	}

	async list(directory: string): Promise<MarketplaceList> {
		const [catalogs, installed] = await Promise.all([
			Promise.all(KINDS.map((kind) => this.#api.list(kind, directory))),
			this.#api.installed(directory),
		]);
		const items = (
			await Promise.all(
				catalogs.flatMap((catalog) => catalog.items).map((item) => this.#toItem(item, directory)),
			)
		).flatMap((item) => (item ? [item] : []));
		const refs = (scope: Scope) =>
			installed.flatMap((entry): MarketplaceItemRef[] =>
				entry.scope === scope && entry.kind !== "plugin"
					? [{ type: entry.kind, id: entry.id }]
					: [],
			);
		return {
			items,
			project: refs("project"),
			global: refs("global"),
			errors: [
				...new Set(
					catalogs.flatMap((catalog) =>
						catalog.failures.map((failure) => `${failure.registry}: ${failure.message}`),
					),
				),
			],
		};
	}

	async #toItem(item: Item, directory: string): Promise<MarketplaceItem | undefined> {
		if (!isContractKind(item)) return undefined;
		this.#registries.set(`${item.kind}:${item.id}`, item.registry);
		return toContractItem(
			item,
			item.kind === "mcp" ? await this.#mcpContent(item, directory) : undefined,
		);
	}

	/** Each install option's preview (or the item's, without options), every parameter left as its placeholder. */
	async #mcpContent(item: Item, directory: string): Promise<McpMarketplaceItem["content"]> {
		const preview = async (option: Item["options"][number] | undefined) =>
			(
				await this.#api.preview(
					{
						registry: item.registry,
						kind: "mcp",
						id: item.id,
						scope: "global",
						params: placeholders([...item.parameters, ...(option?.parameters ?? [])]),
						...(option ? { option: option.name } : {}),
					},
					directory,
				)
			).server;
		if (item.options.length === 0) return preview(undefined);
		return Promise.all(
			item.options.map(async (option) => ({
				name: option.name,
				content: await preview(option),
				...(option.parameters.length > 0
					? { parameters: contractParameters(option.parameters) }
					: {}),
				...(option.prerequisites.length > 0 ? { prerequisites: [...option.prerequisites] } : {}),
			})),
		);
	}

	/**
	 * Installs an item `list` returned; resolves the config file v2 wrote, if
	 * any, relative to the scope's root (`Installed.config`).
	 */
	async install(
		directory: string,
		item: MarketplaceItem,
		scope: Scope,
		method: string | undefined,
		parameters: Readonly<Record<string, string>> | undefined,
	): Promise<string | undefined> {
		const registry = this.#registries.get(`${item.type}:${item.id}`);
		if (!registry) throw new MarketplaceBackendError("Marketplace item is no longer available.");
		const option =
			method ??
			(item.type === "mcp" && typeof item.content !== "string" ? item.content[0]?.name : undefined);
		const installed = await this.#api.install(
			{
				registry,
				kind: item.type,
				id: item.id,
				scope,
				...(option ? { option } : {}),
				...(parameters && Object.keys(parameters).length > 0 ? { params: parameters } : {}),
			},
			directory,
		);
		return installed.config;
	}

	/**
	 * Removes a marketplace install; an agent or skill defined some other way
	 * is removed through `kilocode.agent`/`kilocode.skill`.
	 */
	async remove(directory: string, ref: MarketplaceItemRef, scope: Scope): Promise<void> {
		const record = (await this.#api.installed(directory)).find(
			(entry) => entry.kind === ref.type && entry.id === ref.id && entry.scope === scope,
		);
		if (record) {
			await this.#api.uninstall(
				{ registry: record.registry, kind: ref.type, id: ref.id, scope },
				directory,
			);
			return;
		}
		if (ref.type === "agent") {
			await this.#api.removeAgent(ref.id, scope, directory);
			return;
		}
		if (ref.type === "skill") {
			const skill = (await this.#api.skills(directory)).find((entry) => entry.id === ref.id);
			const removable = new Set(await this.#api.removableSkills(directory));
			if (!skill || !removable.has(skill.path)) {
				throw new MarketplaceBackendError(`Kilo can't remove the skill ${ref.id}.`);
			}
			await this.#api.removeSkill(skill.path, directory);
			return;
		}
		throw new MarketplaceBackendError(`${ref.id} was not installed from the Marketplace.`);
	}

	/** Agents and skills Kilo loads: built in, configured (removable) or from other tools' folders. */
	async runtime(directory: string) {
		const [agents, removableAgents, skills, removableSkills] = await Promise.all([
			this.#api.agents(directory),
			this.#api.removableAgents(directory),
			this.#api.skills(directory),
			this.#api.removableSkills(directory),
		]);
		const configuredAgents = new Set(removableAgents.map((agent) => agent.name));
		const configuredSkills = new Set(removableSkills);
		return {
			agents: agents
				.filter((agent) => !agent.hidden)
				.map((agent) => ({
					id: agent.id,
					name: agent.name,
					description: agent.description,
					configured: configuredAgents.has(agent.id),
				})),
			skills: skills.map((skill) => ({
				id: skill.id,
				description: skill.description,
				content: skill.content,
				location: skill.path.startsWith("/builtin/") ? "builtin" : skill.path,
				configured: configuredSkills.has(skill.path),
			})),
		};
	}

	async mcpStatuses(directory: string): Promise<McpServerStatuses> {
		const servers = await this.#api.mcpServers(directory);
		return {
			servers: servers.map((server) => server.name),
			statuses: Object.fromEntries(
				servers.flatMap((server) => {
					const status = toMcpStatus(server.status);
					return status ? [[server.name, status]] : [];
				}),
			),
		};
	}

	/**
	 * Signs in to an MCP server through its integration's OAuth: opens the
	 * browser and waits for the attempt to finish.
	 */
	async authenticateMcp(
		directory: string,
		name: string,
		open: (url: string) => Promise<unknown>,
		wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	): Promise<void> {
		const server = (await this.#api.mcpServers(directory)).find((entry) => entry.name === name);
		if (!server?.integrationID) {
			throw new MarketplaceBackendError(`Kilo has no sign-in for ${name}.`);
		}
		const [methodID] = await this.#api.oauthMethods(server.integrationID, directory);
		if (!methodID) throw new MarketplaceBackendError(`${name} doesn't sign in with OAuth.`);
		const attempt = await this.#api.oauthConnect(server.integrationID, methodID, directory);
		await open(attempt.url);
		const integrationID = server.integrationID;
		const settle = async (): Promise<void> => {
			const status = await this.#api.oauthStatus(integrationID, attempt.attemptID, directory);
			if (status.status === "complete") return;
			if (status.status === "failed") {
				throw new MarketplaceBackendError(status.message ?? "MCP sign-in failed.");
			}
			if (status.status === "expired") throw new MarketplaceBackendError("MCP sign-in timed out.");
			await wait(1000);
			return settle();
		};
		await settle();
	}
}

export type { MarketplaceType };

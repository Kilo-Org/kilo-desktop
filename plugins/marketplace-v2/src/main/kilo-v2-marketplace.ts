import {
	marketplaceItemSchema,
	type MarketplaceItem,
	type MarketplaceItemRef,
	type MarketplaceMcpStatus,
	type MarketplaceType,
} from "../contracts/index";

/**
 * Kilo v2's Marketplace in the v1 shapes kilo.marketplace's snapshot, install
 * review and settings page use, so those stay as they were.
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
 * becomes the v1 item's `content`, so the install dialog shows what v2 writes
 * and the reviewed-content check binds to it. Previews are local and cheap.
 */

export type V2Kind = "agent" | "skill" | "mcp";
export type V2Scope = "global" | "project";

export interface V2Parameter {
	readonly key: string;
	readonly name: string;
	readonly placeholder?: string | undefined;
	readonly optional: boolean;
	readonly secret?: boolean | undefined;
}

export interface V2Item {
	readonly registry: string;
	readonly kind: V2Kind | "plugin";
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly category?: string | undefined;
	readonly author?: string | undefined;
	readonly url?: string | undefined;
	readonly prerequisites: readonly string[];
	readonly parameters: readonly V2Parameter[];
	readonly options: ReadonlyArray<{
		readonly name: string;
		readonly prerequisites: readonly string[];
		readonly parameters: readonly V2Parameter[];
	}>;
	readonly agent?:
		| {
				readonly mode?: "primary" | "subagent" | "all" | undefined;
				readonly description?: string | undefined;
				readonly system?: string | undefined;
		  }
		| undefined;
}

export interface V2Installed {
	readonly registry: string;
	readonly kind: V2Kind | "plugin";
	readonly id: string;
	readonly scope: V2Scope;
	readonly config?: string | undefined;
}

type InstallInput = {
	readonly registry: string;
	readonly kind: V2Kind;
	readonly id: string;
	readonly scope: V2Scope;
	readonly option?: string;
	readonly params?: Readonly<Record<string, string>>;
};

/** The calls the marketplace makes on Kilo v2, each in `directory`'s location. */
export interface V2MarketplaceApi {
	list(
		kind: V2Kind,
		directory: string,
	): Promise<{
		items: readonly V2Item[];
		failures: ReadonlyArray<{ registry: string; message: string }>;
	}>;
	installed(directory: string): Promise<readonly V2Installed[]>;
	preview(input: InstallInput, directory: string): Promise<{ server: string }>;
	install(input: InstallInput, directory: string): Promise<V2Installed>;
	uninstall(
		input: { registry: string; kind: V2Kind; id: string; scope: V2Scope },
		directory: string,
	): Promise<void>;
	agents(
		directory: string,
	): Promise<
		ReadonlyArray<{ id: string; name: string; description?: string | undefined; hidden: boolean }>
	>;
	removableAgents(directory: string): Promise<ReadonlyArray<{ name: string; scope: V2Scope }>>;
	removeAgent(name: string, scope: V2Scope, directory: string): Promise<void>;
	skills(directory: string): Promise<
		ReadonlyArray<{
			id: string;
			name: string;
			description?: string | undefined;
			path: string;
			content: string;
		}>
	>;
	removableSkills(directory: string): Promise<readonly string[]>;
	removeSkill(path: string, directory: string): Promise<void>;
	mcpServers(directory: string): Promise<
		ReadonlyArray<{
			name: string;
			status: { status: string; error?: string };
			integrationID?: string | undefined;
		}>
	>;
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
const KINDS: readonly V2Kind[] = ["agent", "skill", "mcp"];

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

const placeholders = (parameters: readonly V2Parameter[]) =>
	Object.fromEntries(parameters.map((parameter) => [parameter.key, `{{${parameter.key}}}`]));

const v1Parameters = (parameters: readonly V2Parameter[]) =>
	parameters.map(({ key, name, placeholder, optional }) => ({
		key,
		name,
		optional,
		...(placeholder ? { placeholder } : {}),
	}));

/** A v2 MCP status as v1's; v2's `pending` (still connecting) has no v1 counterpart. */
export function toV1McpStatus(status: { status: string; error?: string }): MarketplaceMcpStatus {
	switch (status.status) {
		case "connected":
		case "disabled":
		case "needs_auth":
			return { status: status.status };
		case "pending":
			return { status: "failed", error: "Kilo is still connecting to this server." };
		default:
			return { status: "failed", error: status.error ?? "The server failed." };
	}
}

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
				catalogs.flatMap((catalog) => catalog.items).map((item) => this.#toV1Item(item, directory)),
			)
		).flatMap((item) => (item ? [item] : []));
		const refs = (scope: V2Scope) =>
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

	async #toV1Item(item: V2Item, directory: string): Promise<MarketplaceItem | undefined> {
		if (item.kind === "plugin") return undefined;
		this.#registries.set(`${item.kind}:${item.id}`, item.registry);
		const base = {
			id: item.id,
			name: item.name,
			description: item.description,
			category: item.category || "other",
			...(item.author ? { author: item.author } : {}),
			...(item.prerequisites.length > 0 ? { prerequisites: [...item.prerequisites] } : {}),
		};
		let candidate: unknown;
		if (item.kind === "agent") {
			candidate = {
				...base,
				...(isHttpUrl(item.url) ? { authorUrl: item.url } : {}),
				type: "agent",
				content: {
					mode: item.agent?.mode ?? "primary",
					description: item.agent?.description ?? item.description,
					prompt: item.agent?.system ?? "",
				},
			};
		} else if (item.kind === "skill") {
			if (!isHttpUrl(item.url)) return undefined;
			candidate = { ...base, type: "skill", content: item.url, githubUrl: item.url };
		} else {
			candidate = {
				...base,
				type: "mcp",
				url: isHttpUrl(item.url) ? item.url : CATALOG_FALLBACK_URL,
				...(item.parameters.length > 0 ? { parameters: v1Parameters(item.parameters) } : {}),
				content: await this.#mcpContent(item, directory),
			};
		}
		const parsed = marketplaceItemSchema.safeParse(candidate);
		return parsed.success ? parsed.data : undefined;
	}

	async #mcpContent(item: V2Item, directory: string) {
		const preview = (option: V2Item["options"][number] | undefined) =>
			this.#api
				.preview(
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
				.then(({ server }) => server);
		if (item.options.length === 0) return preview(undefined);
		return Promise.all(
			item.options.map(async (option) => ({
				name: option.name,
				content: await preview(option),
				...(option.parameters.length > 0 ? { parameters: v1Parameters(option.parameters) } : {}),
				...(option.prerequisites.length > 0 ? { prerequisites: [...option.prerequisites] } : {}),
			})),
		);
	}

	/** Installs an item `list` returned; resolves the config file v2 wrote, if any. */
	async install(
		directory: string,
		item: MarketplaceItem,
		scope: V2Scope,
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
	async remove(directory: string, ref: MarketplaceItemRef, scope: V2Scope): Promise<void> {
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

	async mcpStatuses(directory: string): Promise<Record<string, MarketplaceMcpStatus>> {
		const servers = await this.#api.mcpServers(directory);
		return Object.fromEntries(servers.map((server) => [server.name, toV1McpStatus(server.status)]));
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

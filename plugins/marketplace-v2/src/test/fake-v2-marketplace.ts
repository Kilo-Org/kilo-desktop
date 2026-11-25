import type { McpServer } from "@kilocode/client";
import type { Mcp } from "@opencode/schema/mcp";

import type {
	InstallInput,
	Installed,
	Item,
	Kind,
	PreviewInput,
	Scope,
	UninstallInput,
	V2MarketplaceApi,
} from "../main/kilo-v2-marketplace";
import { MarketplaceBackendError } from "../main/kilo-v2-marketplace";

type Call = [method: string, directory: string, input?: unknown];

/** A catalog item with v2's defaults for the lists a test leaves out. */
export const catalogItem = (
	item: Pick<Item, "kind" | "id"> & Partial<Item>,
	registry = "kilo",
): Item => ({
	registry,
	name: item.id,
	description: "",
	tags: [],
	prerequisites: [],
	parameters: [],
	options: [],
	...item,
});

/**
 * Kilo v2's Marketplace, agents, skills and MCP servers in memory, behind
 * `V2MarketplaceApi`: a catalog per kind, managed installs per scope (project
 * ones per directory), and a preview that renders an MCP option's server
 * config the way v2 does: parameters interpolated, nonempty secret ones
 * `[redacted]`, as pretty-printed `Mcp.ServerConfig` JSON. Records every call
 * with the directory it was made in.
 */
export class FakeV2Marketplace implements V2MarketplaceApi {
	catalog: Item[] = [];
	/** The v2 server config per `id` or `id:option`, `{{key}}` placeholders interpolated by preview. */
	templates: Record<string, Mcp.ServerConfig> = {};
	/** The config file installs write, relative to the scope root. */
	configFile = "kilo.json";
	installs: (Installed & { directory: string })[] = [];
	agentList: { id: string; name: string; description?: string; hidden: boolean }[] = [];
	removableAgentList: { name: string; scope: Scope }[] = [];
	skillList: { id: string; name: string; description?: string; path: string; content: string }[] =
		[];
	removableSkillList: string[] = [];
	servers: McpServer[] = [];
	oauth: { methods: string[]; statuses: ("pending" | "complete" | "failed" | "expired")[] } = {
		methods: ["oauth"],
		statuses: ["complete"],
	};
	failures: { registry: string; message: string }[] = [];
	failInstall: string | undefined;
	readonly calls: Call[] = [];

	#record(method: string, directory: string, input?: unknown) {
		this.calls.push(input === undefined ? [method, directory] : [method, directory, input]);
	}

	callsTo(method: string): Call[] {
		return this.calls.filter(([name]) => name === method);
	}

	/** What preview renders for `id` (and `option`) with `params`. */
	render(id: string, option: string | undefined, params: Readonly<Record<string, string>> = {}) {
		const item = this.catalog.find((entry) => entry.kind === "mcp" && entry.id === id);
		const parameters = [
			...(item?.parameters ?? []),
			...(item?.options.find((entry) => entry.name === option)?.parameters ?? []),
		];
		const secrets = parameters.filter(
			(parameter) => parameter.secret && params[parameter.key]?.trim(),
		);
		const values: Record<string, string> = {
			...params,
			...Object.fromEntries(secrets.map((parameter) => [parameter.key, "[redacted]"])),
		};
		const template = this.templates[option ? `${id}:${option}` : id] ?? {
			type: "local",
			command: [id],
		};
		const server = JSON.parse(JSON.stringify(template), (_key, value: unknown) =>
			typeof value === "string"
				? value.replace(
						/\{\{([^{}]+)\}\}/g,
						(placeholder, key: string) => values[key] ?? placeholder,
					)
				: value,
		) as Mcp.ServerConfig;
		return {
			server: JSON.stringify(server, null, 2),
			parameters: parameters.map((parameter) => `${parameter.name} (${parameter.key})`),
			secrets: secrets.map((parameter) => parameter.name),
		};
	}

	async list(kind: Kind, directory: string) {
		this.#record("list", directory, kind);
		return { items: this.catalog.filter((item) => item.kind === kind), failures: this.failures };
	}

	async installed(directory: string) {
		this.#record("installed", directory);
		return this.installs.filter(
			(entry) => entry.scope === "global" || entry.directory === directory,
		);
	}

	async preview(input: PreviewInput, directory: string) {
		this.#record("preview", directory, input);
		return {
			...this.render(input.id, input.option, input.params),
			config: `${directory}/${this.configFile}`,
		};
	}

	async install(input: InstallInput, directory: string) {
		this.#record("install", directory, input);
		if (this.failInstall) throw new MarketplaceBackendError(this.failInstall);
		const entry = {
			version: 1 as const,
			registry: input.registry,
			kind: input.kind,
			id: input.id,
			scope: input.scope,
			...(input.option ? { option: input.option } : {}),
			...(input.kind === "mcp" ? { config: this.configFile, server: input.id } : {}),
			installedAt: 0,
			directory,
		};
		this.installs.push(entry);
		return entry;
	}

	async uninstall(input: UninstallInput, directory: string) {
		this.#record("uninstall", directory, input);
		this.installs = this.installs.filter(
			(entry) =>
				!(entry.kind === input.kind && entry.id === input.id && entry.scope === input.scope),
		);
	}

	async agents(directory: string) {
		this.#record("agents", directory);
		return this.agentList;
	}

	async removableAgents(_directory: string) {
		return this.removableAgentList;
	}

	async removeAgent(name: string, scope: Scope, directory: string) {
		this.#record("removeAgent", directory, { name, scope });
	}

	async skills(directory: string) {
		this.#record("skills", directory);
		return this.skillList;
	}

	async removableSkills(_directory: string) {
		return this.removableSkillList;
	}

	async removeSkill(path: string, directory: string) {
		this.#record("removeSkill", directory, { path });
	}

	async mcpServers(directory: string) {
		this.#record("mcpServers", directory);
		return this.servers;
	}

	async oauthMethods(_integrationID: string, _directory: string) {
		return this.oauth.methods;
	}

	async oauthConnect(integrationID: string, methodID: string, directory: string) {
		this.#record("oauthConnect", directory, { integrationID, methodID });
		return { attemptID: "att_1", url: `https://auth.example/${integrationID}`, expires: 0 };
	}

	async oauthStatus(_integrationID: string, _attemptID: string, _directory: string) {
		const status =
			this.oauth.statuses.length > 1 ? this.oauth.statuses.shift()! : this.oauth.statuses[0]!;
		return status === "failed" ? { status, message: "Denied" } : { status };
	}
}

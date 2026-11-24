import type {
	V2Installed,
	V2Item,
	V2Kind,
	V2MarketplaceApi,
	V2Scope,
} from "../main/kilo-v2-marketplace";
import { MarketplaceBackendError } from "../main/kilo-v2-marketplace";

type Call = [method: string, directory: string, input?: unknown];

/**
 * Kilo v2's Marketplace, agents, skills and MCP servers in memory, behind
 * `V2MarketplaceApi`: a catalog per kind, managed installs per scope (project
 * ones per directory), and a preview that renders an MCP option's template
 * with its parameters. Records every call with the directory it was made in.
 */
export class FakeV2Marketplace implements V2MarketplaceApi {
	catalog: V2Item[] = [];
	/** An MCP template per `id` or `id:option`, `{{key}}` substituted by preview. */
	templates: Record<string, string> = {};
	installs: (V2Installed & { directory: string })[] = [];
	agentList: { id: string; name: string; description?: string; hidden: boolean }[] = [];
	removableAgentList: { name: string; scope: V2Scope }[] = [];
	skillList: { id: string; name: string; description?: string; path: string; content: string }[] =
		[];
	removableSkillList: string[] = [];
	servers: { name: string; status: { status: string; error?: string }; integrationID?: string }[] =
		[];
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

	async list(kind: V2Kind, directory: string) {
		this.#record("list", directory, kind);
		return { items: this.catalog.filter((item) => item.kind === kind), failures: this.failures };
	}

	async installed(directory: string) {
		this.#record("installed", directory);
		return this.installs.filter(
			(entry) => entry.scope === "global" || entry.directory === directory,
		);
	}

	async preview(
		input: { id: string; option?: string; params?: Readonly<Record<string, string>> },
		directory: string,
	) {
		this.#record("preview", directory, input);
		const template =
			this.templates[input.option ? `${input.id}:${input.option}` : input.id] ?? "{}";
		const server = Object.entries(input.params ?? {}).reduce(
			(text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
			template,
		);
		return { server };
	}

	async install(
		input: {
			registry: string;
			kind: V2Kind;
			id: string;
			scope: V2Scope;
			option?: string;
			params?: Readonly<Record<string, string>>;
		},
		directory: string,
	) {
		this.#record("install", directory, input);
		if (this.failInstall) throw new MarketplaceBackendError(this.failInstall);
		const entry = {
			registry: input.registry,
			kind: input.kind,
			id: input.id,
			scope: input.scope,
			config: `${directory}/kilo2.json`,
			directory,
		};
		this.installs.push(entry);
		return entry;
	}

	async uninstall(input: { kind: V2Kind; id: string; scope: V2Scope }, directory: string) {
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

	async removeAgent(name: string, scope: V2Scope, directory: string) {
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

// An in-memory Kilo v2 server for kilo.marketplace's main tests. It answers
// `@kilocode/client`'s HTTP requests as its `fetch`: the Marketplace RPC
// (`kilocode.marketplace`), the agent and skill removal RPCs' `removable`
// lists, and the `/api` lists the marketplace reads (agents, skills, MCP
// servers, integrations, plugins) with MCP sign-in through integration OAuth.
// Global installations show in every location; project installations only in
// their own, as in kilo2.
import type { AgentInfo, IntegrationInfo, McpServer, SkillInfo } from "@kilocode/client";
import type { KiloMarketplaceRpc } from "@kilocode/schema/kilocode/marketplace";

export const FAKE_KILO2_BASE_URL = "http://kilo2-marketplace.test";
export const GLOBAL_DIRECTORY = "/runtime";

type Kind = KiloMarketplaceRpc.Kind;
type Item = KiloMarketplaceRpc.Item;
type Record = KiloMarketplaceRpc.Installed;

export interface RecordedRequest {
	readonly method: string;
	readonly path: string;
	readonly directory: string | undefined;
	readonly input: unknown;
}

/** What one location has besides Marketplace installations. */
export interface FakeLocation {
	agents: AgentInfo[];
	/** Agent ids a config file defines (`kilocode.agent.removable`). */
	customAgents: string[];
	skills: SkillInfo[];
	/** Skill manifest paths in a configured skill directory (`kilocode.skill.removable`). */
	customSkills: string[];
	/** MCP servers configured outside the Marketplace. */
	mcp: McpServer[];
	integrations: IntegrationInfo[];
	/** Polls of `plugin.list` that list nothing before the location's plugins load. */
	startingPolls: number;
}

interface SignIn {
	readonly integrationID: string;
	readonly attemptID: string;
	status: "pending" | "complete" | "failed" | "expired";
	message?: string;
}

const JSON_HEADERS = { "content-type": "application/json" };
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
const empty = () => new Response(null, { status: 204 });
const rpcError = (type: string, message: string) => json({ _tag: "RpcError", type, message }, 400);

/** A catalog item with v2's defaults; `kind` and `id` name it. */
export function catalogItem(
	input: Partial<Item> & { readonly kind: Kind; readonly id: string },
): Item {
	return {
		registry: "kilo",
		name: input.id,
		description: `${input.id} description`,
		tags: [],
		prerequisites: [],
		parameters: [],
		options: [],
		...input,
	};
}

/** An agent as `agent.list` reports it. */
export function agentInfo(id: string, fields: Partial<AgentInfo> = {}): AgentInfo {
	return {
		id: id as AgentInfo["id"],
		name: id,
		request: {} as AgentInfo["request"],
		mode: "primary",
		hidden: false,
		permissions: [] as AgentInfo["permissions"],
		...fields,
	};
}

/** A skill as `skill.list` reports it. */
export function skillInfo(id: string, path: string, fields: Partial<SkillInfo> = {}): SkillInfo {
	return {
		id: id as SkillInfo["id"],
		name: id as SkillInfo["name"],
		path: path as SkillInfo["path"],
		content: "",
		...fields,
	};
}

function serverName(id: string): string {
	return id.replace(/[^A-Za-z0-9_-]+/g, "-");
}

function substitute(value: unknown, params: Readonly<{ [key: string]: string }>): unknown {
	if (typeof value === "string") {
		return value.replace(
			/\{\{([^{}]+)\}\}/g,
			(placeholder, key: string) => params[key] ?? placeholder,
		);
	}
	if (Array.isArray(value)) return value.map((entry) => substitute(entry, params));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, substitute(entry, params)]),
		);
	}
	return value;
}

export class FakeKilo2Marketplace {
	readonly catalog: { [kind in Kind]: Item[] } = { agent: [], skill: [], mcp: [], plugin: [] };
	/** Registry warnings `list` returns beside a (saved) catalog. */
	readonly catalogFailures: { registry: string; message: string }[] = [];
	/** Kinds whose `list` fails outright. */
	readonly failingKinds = new Set<Kind>();
	/** Each MCP item's server entry per install option (`""` for an item without options). */
	readonly mcpTemplates = new Map<string, { [option: string]: object }>();
	/** The state each installed MCP server reports. */
	installedMcpStatus: McpServer["status"] = { status: "connected" };
	/** The integration an installed MCP server signs in through, by server name. */
	readonly mcpIntegrations = new Map<string, string>();
	/** The next install fails with this RPC error. */
	installFailure: { type: string; message: string } | undefined;
	/** RPC methods answering `rpc.unavailable` once, as a starting location does. */
	readonly unavailableOnce = new Set<string>();
	readonly records: Record[] = [];
	readonly requests: RecordedRequest[] = [];
	readonly opened: string[] = [];
	readonly #locations = new Map<string, FakeLocation>();
	readonly #signIns: SignIn[] = [];

	location(directory: string): FakeLocation {
		let location = this.#locations.get(directory);
		if (!location) {
			location = {
				agents: [],
				customAgents: [],
				skills: [],
				customSkills: [],
				mcp: [],
				integrations: [],
				startingPolls: 0,
			};
			this.#locations.set(directory, location);
		}
		return location;
	}

	/** Records an installation as Kilo would have written it. */
	addRecord(record: Partial<Record> & Pick<Record, "kind" | "id" | "scope">): Record {
		const stored: Record = {
			version: 1,
			registry: "kilo",
			installedAt: 1,
			...(record.kind === "mcp" ? { server: serverName(record.id) } : {}),
			...record,
		};
		this.records.push(stored);
		return stored;
	}

	/** Sign-ins started through integration OAuth. */
	get signIns(): readonly SignIn[] {
		return this.#signIns;
	}

	/** The person finishes (or fails) the sign-in in their browser. */
	settleSignIn(status: "complete" | "failed" | "expired", message?: string): void {
		for (const signIn of this.#signIns) {
			if (signIn.status !== "pending") continue;
			signIn.status = status;
			if (message) signIn.message = message;
		}
	}

	rpcCalls(rpcID: string, method: string): RecordedRequest[] {
		return this.requests.filter((request) => request.path === `/api/rpc/${rpcID}/${method}`);
	}

	readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = input instanceof Request ? input : new Request(input, init);
		const url = new URL(request.url);
		const directory = url.searchParams.get("location[directory]") ?? undefined;
		const text =
			request.method === "GET" || request.method === "DELETE" ? "" : await request.text();
		const body = text ? (JSON.parse(text) as { input?: unknown }) : {};
		this.requests.push({
			method: request.method,
			path: url.pathname,
			directory,
			input: body.input ?? body,
		});
		return this.#route(request.method, url.pathname, directory ?? GLOBAL_DIRECTORY, body);
	};

	#route(method: string, path: string, directory: string, body: { input?: unknown }): Response {
		const location = this.location(directory);
		const listed = (data: unknown) => json({ location: { directory }, data });
		if (method === "GET" && path === "/api/plugin") {
			if (location.startingPolls > 0) {
				location.startingPolls -= 1;
				return listed([]);
			}
			return listed([{ id: "kilocode.marketplace" }]);
		}
		if (method === "GET" && path === "/api/agent") return listed(location.agents);
		if (method === "GET" && path === "/api/skill") return listed(location.skills);
		if (method === "GET" && path === "/api/mcp") return listed(this.#mcpServers(directory));
		if (method === "GET" && path === "/api/integration") return listed(location.integrations);
		const oauth = path.match(/^\/api\/integration\/([^/]+)\/connect\/oauth(?:\/([^/]+))?$/);
		if (oauth) return this.#oauth(method, decodeURIComponent(oauth[1]!), oauth[2], directory);
		const rpc = path.match(/^\/api\/rpc\/([^/]+)\/([^/]+)$/);
		if (method === "POST" && rpc) {
			const key = `${rpc[1]}.${rpc[2]}`;
			if (this.unavailableOnce.delete(key)) {
				return rpcError("rpc.unavailable", `No RPC ${rpc[1]} in this location.`);
			}
			return this.#rpc(rpc[1]!, rpc[2]!, directory, (body.input ?? {}) as never);
		}
		return json({ _tag: "UnknownError", message: `No fake route for ${method} ${path}` }, 500);
	}

	#mcpServers(directory: string): McpServer[] {
		const installed = this.records
			.filter(
				(record) =>
					record.kind === "mcp" && (record.scope === "global" || record.project === directory),
			)
			.map((record): McpServer => {
				const integrationID = this.mcpIntegrations.get(record.server!);
				return {
					name: record.server!,
					status: this.installedMcpStatus,
					...(integrationID
						? { integrationID: integrationID as NonNullable<McpServer["integrationID"]> }
						: {}),
				};
			});
		const configured = [
			...this.location(GLOBAL_DIRECTORY).mcp,
			...(directory === GLOBAL_DIRECTORY ? [] : this.location(directory).mcp),
		];
		return [...installed, ...configured];
	}

	#oauth(method: string, integrationID: string, attemptID: string | undefined, directory: string) {
		if (method === "POST" && attemptID === undefined) {
			const signIn: SignIn = {
				integrationID,
				attemptID: `att_${this.#signIns.length + 1}`,
				status: "pending",
			};
			this.#signIns.push(signIn);
			return json({
				location: { directory },
				data: {
					attemptID: signIn.attemptID,
					url: `https://auth.example/${integrationID}`,
					instructions: "",
					mode: "auto",
					time: { created: 1, expires: 2 },
				},
			});
		}
		const signIn = this.#signIns.find(
			(entry) => entry.integrationID === integrationID && entry.attemptID === attemptID,
		);
		if (!signIn) {
			return json(
				{ _tag: "IntegrationAttemptNotFoundError", integrationID, attemptID, message: "gone" },
				404,
			);
		}
		if (method === "DELETE") {
			signIn.status = "expired";
			return empty();
		}
		return json({
			location: { directory },
			data: {
				status: signIn.status,
				time: { created: 1, expires: 2 },
				...(signIn.status === "failed" ? { message: signIn.message ?? "Sign-in failed." } : {}),
			},
		});
	}

	#rpc(rpcID: string, method: string, directory: string, input: never): Response {
		if (rpcID === "kilocode.agent" && method === "removable") {
			return json({
				output: this.location(directory).customAgents.map((name) => ({
					name,
					path: `${directory}/.kilo2/agents/${name}.md`,
					scope: "project",
				})),
			});
		}
		if (rpcID === "kilocode.skill" && method === "removable") {
			return json({ output: this.location(directory).customSkills });
		}
		if (rpcID !== "kilocode.marketplace") return rpcError("rpc.unavailable", `No RPC ${rpcID}.`);
		switch (method) {
			case "list":
				return this.#list(input);
			case "installed":
				return json({
					output: this.records.filter(
						(record) => record.scope === "global" || record.project === directory,
					),
				});
			case "preview":
				return this.#preview(input, directory);
			case "install":
				return this.#install(input, directory);
			case "uninstall":
				return this.#uninstall(input, directory);
			default:
				return rpcError("rpc.unavailable", `No method ${method}.`);
		}
	}

	#list(input: { kind: Kind }): Response {
		if (this.failingKinds.has(input.kind)) {
			return rpcError("fetch_failed", `Couldn't load Kilo Marketplace: ${input.kind}`);
		}
		return json({ output: { items: this.catalog[input.kind], failures: this.catalogFailures } });
	}

	#item(input: { registry: string; kind: Kind; id: string }): Item | undefined {
		return this.catalog[input.kind].find(
			(item) => item.registry === input.registry && item.id === input.id,
		);
	}

	#server(
		item: Item,
		input: { option?: string; params?: { [key: string]: string } },
		redact: boolean,
	): object {
		const templates = this.mcpTemplates.get(item.id) ?? {};
		const option = input.option ?? item.options[0]?.name ?? "";
		const template = templates[option];
		if (!template) throw new Error(`${item.name} has no install option ${option}`);
		const parameters = [
			...item.parameters,
			...(item.options.find((entry) => entry.name === option)?.parameters ?? []),
		];
		const missing = parameters.filter(
			(parameter) => !parameter.optional && !input.params?.[parameter.key]?.trim(),
		);
		if (missing.length) {
			throw Object.assign(
				new Error(`Missing required parameters: ${missing.map((entry) => entry.name).join(", ")}`),
				{ type: "invalid_params" },
			);
		}
		const params = Object.fromEntries(
			parameters.map((parameter) => [
				parameter.key,
				redact && parameter.secret && input.params?.[parameter.key]
					? "[redacted]"
					: (input.params?.[parameter.key] ?? ""),
			]),
		);
		return substitute(template, params) as object;
	}

	#preview(
		input: {
			registry: string;
			kind: Kind;
			id: string;
			scope: string;
			option?: string;
			params?: { [key: string]: string };
		},
		directory: string,
	): Response {
		const item = this.#item(input);
		if (!item) return rpcError("not_found", `No ${input.kind} ${input.id} in ${input.registry}`);
		try {
			const server = this.#server(item, input, true);
			return json({
				output: {
					server: JSON.stringify(server, null, 2),
					config:
						input.scope === "global"
							? "/home/.config/kilo2/kilo2.jsonc"
							: `${directory}/.kilo2/kilo2.jsonc`,
					parameters: [],
					secrets: [],
				},
			});
		} catch (error) {
			return rpcError(
				(error as { type?: string }).type ?? "invalid_params",
				(error as Error).message,
			);
		}
	}

	#install(
		input: {
			registry: string;
			kind: Kind;
			id: string;
			scope: "global" | "project";
			option?: string;
			params?: { [key: string]: string };
		},
		directory: string,
	): Response {
		if (this.installFailure) {
			const { type, message } = this.installFailure;
			this.installFailure = undefined;
			return rpcError(type, message);
		}
		const item = this.#item(input);
		if (!item) return rpcError("not_found", `No ${input.kind} ${input.id} in ${input.registry}`);
		if (item.kind === "mcp") {
			try {
				this.#server(item, input, false);
			} catch (error) {
				return rpcError(
					(error as { type?: string }).type ?? "invalid_params",
					(error as Error).message,
				);
			}
		}
		const record = this.addRecord({
			registry: input.registry,
			kind: input.kind,
			id: input.id,
			scope: input.scope,
			...(input.scope === "project" ? { project: directory } : {}),
			...(input.option ? { option: input.option } : {}),
			status: "ready",
		});
		return json({ output: record });
	}

	#uninstall(
		input: { registry: string; kind: Kind; id: string; scope: "global" | "project" },
		directory: string,
	): Response {
		const index = this.records.findIndex(
			(record) =>
				record.registry === input.registry &&
				record.kind === input.kind &&
				record.id === input.id &&
				record.scope === input.scope &&
				(input.scope === "global" || record.project === directory),
		);
		if (index < 0)
			return rpcError("not_found", `${input.id} was not installed from the marketplace`);
		this.records.splice(index, 1);
		return json({ output: {} });
	}
}

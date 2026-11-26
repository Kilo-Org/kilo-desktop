import { KernelError, type DomainObjectMethods, type KernelLogger } from "@kilo-desktop/kernel";
import type { McpServer } from "@kilocode/client";
import which from "which";
import { parse as parseYaml } from "yaml";

import {
	type Marketplace,
	type MarketplaceIncludedItem,
	type MarketplaceInstalled,
	type MarketplaceInstallInput,
	type MarketplaceItem,
	type MarketplaceKind,
	type MarketplaceMcpStatus,
	type MarketplacePreviewInput,
	type MarketplaceScope,
	type MarketplaceTarget,
	marketplaceItemSchema,
	marketplaceKindSchema,
} from "../contracts/index";
import { installCommands } from "../contracts/runtimes";
import {
	createKiloClient,
	type KiloConnection,
	KiloLocation,
	KiloRpcError,
	type MarketplaceRecord,
} from "./kilo-marketplace-client";

export interface MarketplaceWorkspace {
	readonly id: string;
	readonly name: string;
	readonly color?: string | undefined;
	readonly folders: ReadonlyArray<{ readonly path: string; readonly isPrimary: boolean }>;
}

/** What the marketplace reads from the rest of the app (kilo.core, kilo.work-sessions, the kernel). */
export interface MarketplaceDependencies {
	/** How to reach Kilo's server; rejects while it is unavailable. */
	readonly connect: () => Promise<KiloConnection>;
	/** The registered workspaces; null without kilo.work-sessions. */
	readonly workspaces: () => readonly MarketplaceWorkspace[] | null;
	/** MCP servers the app itself adds to Kilo (`kilo.core/mcp-server`). */
	readonly desktopMcps: () => Promise<ReadonlyArray<{ readonly id: string }>>;
	readonly fetch: typeof globalThis.fetch;
	/** Opens an MCP server's sign-in page in the person's browser; false when it couldn't. */
	readonly openExternal: (url: string) => Promise<boolean>;
	readonly logger: KernelLogger;
	/** Resolves a bare command on PATH (`which`); null when missing. */
	readonly which?: (command: string) => string | null;
	readonly platform?: NodeJS.Platform;
	/** How often MCP sign-in asks whether the person finished (1 s). */
	readonly signInPollMs?: number;
	/** How long a still-starting location is waited for (30 s). */
	readonly pluginsWaitMs?: number;
}

export type MarketplaceApi = DomainObjectMethods<typeof Marketplace>;

const KINDS = marketplaceKindSchema.options;
const SIGN_IN_POLL_MS = 1_000;

const compatibilitySkillPath = /(?:^|[/\\])\.(?:claude|agents)[/\\]skills(?:[/\\]|$)/;

function frontmatterDescription(content: string | undefined): string | undefined {
	const frontmatter = content?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
	if (!frontmatter) return undefined;
	try {
		const parsed: unknown = parseYaml(frontmatter);
		if (!parsed || typeof parsed !== "object" || !("description" in parsed)) return undefined;
		const value = (parsed as { description?: unknown }).description;
		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	} catch {
		return undefined;
	}
}

function displayName(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((word, index) => {
			if (word.toLocaleLowerCase() === "mcp") return "MCP";
			return index === 0 ? `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}` : word;
		})
		.join(" ");
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function mcpStatus(server: McpServer): MarketplaceMcpStatus {
	return server.status;
}

/**
 * Turns failures into the kernel's: a Kilo RPC failure carries Kilo's own
 * message (a conflict, missing parameters, a failed fetch) as a BUSINESS error.
 */
function operationError(error: unknown): never {
	if (error instanceof KernelError) throw error;
	if (error instanceof KiloRpcError) throw new KernelError("BUSINESS", error.message);
	throw error;
}

/**
 * kilo.marketplace's main side: Kilo v2's Marketplace (`kilocode.marketplace`)
 * across Desktop's workspaces.
 *
 * Kilo owns the catalog, the installation records and every write; Desktop
 * adds workspace identity, each record's MCP server state (`mcp.list` in the
 * record's location), what Kilo already has besides (agents and skills from
 * v2's lists, built in or configured; MCP servers Kilo or Desktop configured),
 * and whether an MCP's launch command resolves on PATH. The catalog comes from
 * Kilo's global location; global records from there and each workspace's
 * project records from its primary folder's location, since `installed` lists
 * one project's records.
 *
 * An MCP install is bound to what the person reviewed: the dialog shows Kilo's
 * own `preview` of the entry, and install previews again and refuses when Kilo
 * would now write anything else.
 */
export function createMarketplaceApi(deps: MarketplaceDependencies): MarketplaceApi {
	const targets = (): MarketplaceTarget[] =>
		(deps.workspaces() ?? []).flatMap((workspace) => {
			const primary = workspace.folders.find((folder) => folder.isPrimary);
			return primary
				? [
						{
							id: workspace.id,
							name: workspace.name,
							directory: primary.path,
							...(workspace.color ? { color: workspace.color } : {}),
						},
					]
				: [];
		});
	const resolveWorkspace = (workspaceId: string | undefined): MarketplaceTarget => {
		if (!workspaceId) throw new KernelError("BUSINESS", "Select a workspace before continuing.");
		const target = targets().find((candidate) => candidate.id === workspaceId);
		if (!target) throw new KernelError("NOT_FOUND", "Workspace not found.");
		return target;
	};

	const kilo = async () => {
		const connection = await deps.connect();
		const client = createKiloClient(connection, deps.fetch);
		const at = (directory: string) =>
			new KiloLocation(client, directory, {
				...(deps.pluginsWaitMs === undefined ? {} : { waitMs: deps.pluginsWaitMs }),
			});
		return { global: at(connection.globalDirectory), at };
	};
	/** The location a scope writes through: Kilo's global location, or the workspace's folder. */
	const destination = async (input: {
		scope: MarketplaceScope;
		workspaceId?: string | undefined;
	}) => {
		const server = await kilo();
		return input.scope === "project"
			? server.at(resolveWorkspace(input.workspaceId).directory)
			: server.global;
	};

	const catalog = async (global: KiloLocation, refresh: boolean) => {
		const results = await Promise.allSettled(KINDS.map((kind) => global.catalog(kind, refresh)));
		const items: MarketplaceItem[] = [];
		const errors: string[] = [];
		let failures = 0;
		for (const [index, result] of results.entries()) {
			if (result.status === "rejected") {
				failures += 1;
				errors.push(`${KINDS[index]}: ${message(result.reason)}`);
				continue;
			}
			for (const item of result.value.items) {
				const parsed = marketplaceItemSchema.safeParse(item);
				if (parsed.success) items.push(parsed.data);
			}
			for (const failure of result.value.failures) {
				errors.push(`${failure.registry}: ${failure.message}`);
			}
		}
		if (failures === KINDS.length) {
			const first = results.find((result) => result.status === "rejected");
			return operationError(first?.reason);
		}
		return { items, errors, stale: errors.length > 0 && failures === 0 };
	};

	const records = async (location: KiloLocation, scope: MarketplaceScope) => {
		try {
			return (await location.installed()).filter(
				(record) => record.scope === scope && record.kind !== "plugin",
			);
		} catch (error) {
			deps.logger.warn("Could not list Marketplace installations.", {
				directory: location.directory,
				error,
			});
			return [];
		}
	};

	const mcpServers = async (location: KiloLocation): Promise<McpServer[]> => {
		try {
			return await location.mcpServers();
		} catch (error) {
			deps.logger.warn("Could not read Kilo MCP status.", { directory: location.directory, error });
			return [];
		}
	};

	/** Kilo's agents and skills in `location`: built in, or configured in a config directory. */
	const inventory = async (
		location: KiloLocation,
	): Promise<{ builtIn: MarketplaceIncludedItem[]; configured: MarketplaceIncludedItem[] }> => {
		try {
			const [agents, removableAgents, skills, removableSkills] = await Promise.all([
				location.agents(),
				location.removableAgents().catch(() => []),
				location.skills(),
				location.removableSkills().catch(() => []),
			]);
			const customAgents = new Set(removableAgents.map((agent) => agent.name));
			const customSkills = new Set(removableSkills);
			const builtIn: MarketplaceIncludedItem[] = [];
			const configured: MarketplaceIncludedItem[] = [];
			for (const agent of agents) {
				if (agent.hidden) continue;
				const custom = customAgents.has(agent.id);
				(custom ? configured : builtIn).push({
					kind: "agent",
					id: agent.id,
					name: agent.name && agent.name !== agent.id ? agent.name : displayName(agent.id),
					description:
						agent.description ?? (custom ? "Configured in Kilo." : "Included with Kilo."),
					category: custom ? "Custom" : "Built-in",
					installedIn: "Kilo",
				});
			}
			for (const skill of skills) {
				if (compatibilitySkillPath.test(skill.path)) continue;
				const custom = customSkills.has(skill.path);
				(custom ? configured : builtIn).push({
					kind: "skill",
					id: skill.id,
					name: displayName(skill.name),
					description:
						skill.description?.trim() ||
						frontmatterDescription(skill.content) ||
						(custom ? "Configured in Kilo." : "Included with Kilo."),
					category: custom ? "Custom" : "Built-in",
					installedIn: "Kilo",
				});
			}
			return { builtIn, configured };
		} catch (error) {
			deps.logger.warn("Could not list Kilo's agents and skills.", {
				directory: location.directory,
				error,
			});
			return { builtIn: [], configured: [] };
		}
	};

	const desktopMcps = async (): Promise<ReadonlyArray<{ readonly id: string }>> => {
		try {
			return await deps.desktopMcps();
		} catch (error) {
			deps.logger.warn("Could not list Desktop-managed MCPs.", { error });
			return [];
		}
	};

	const snapshot = async (workspaceId: string | undefined, refresh: boolean) => {
		const available = targets();
		const server = await kilo();
		const selected = workspaceId
			? available.find((target) => target.id === workspaceId)
			: undefined;
		const workspaces = available.map((target) => ({
			target,
			location: server.at(target.directory),
		}));
		const selectedLocation =
			workspaces.find(({ target }) => target === selected)?.location ?? server.global;
		const [listed, globalRecords, projectRecords, runtime, globalServers, projectServers, desktop] =
			await Promise.all([
				catalog(server.global, refresh),
				records(server.global, "global"),
				Promise.all(workspaces.map(({ location }) => records(location, "project"))),
				inventory(selectedLocation),
				mcpServers(server.global),
				Promise.all(workspaces.map(({ location }) => mcpServers(location))),
				desktopMcps(),
			]);
		const byName = (servers: readonly McpServer[]) =>
			new Map(servers.map((entry) => [entry.name, entry]));
		const globalByName = byName(globalServers);
		const runtimeByKey = new Map(
			[...runtime.configured, ...runtime.builtIn].map((entry) => [
				`${entry.kind}:${entry.id}`,
				entry,
			]),
		);
		const placed = (
			record: MarketplaceRecord,
			servers: ReadonlyMap<string, McpServer>,
			target?: MarketplaceTarget,
		): MarketplaceInstalled => {
			const kind = record.kind as MarketplaceKind;
			const server = record.server ? servers.get(record.server) : undefined;
			const known = runtimeByKey.get(`${kind}:${record.id}`);
			return {
				registry: record.registry,
				kind,
				id: record.id,
				scope: record.scope,
				...(target ? { workspaceId: target.id } : {}),
				...(record.option ? { option: record.option } : {}),
				...(record.server ? { server: record.server } : {}),
				...(record.status ? { status: record.status } : {}),
				...(record.recovering ? { recovering: true } : {}),
				...(record.warnings?.length ? { warnings: [...record.warnings] } : {}),
				...(kind === "mcp" && server ? { mcpStatus: mcpStatus(server) } : {}),
				...(known ? { name: known.name, description: known.description } : {}),
			};
		};
		const installed = [
			...globalRecords.map((record) => placed(record, globalByName)),
			...workspaces.flatMap(({ target }, index) => {
				const servers = byName(projectServers[index] ?? []);
				return (projectRecords[index] ?? []).map((record) => placed(record, servers, target));
			}),
		];

		// Everything Kilo has that the Marketplace didn't install, once each.
		const owned = new Set(installed.map((entry) => `${entry.kind}:${entry.id}`));
		const ownedServers = new Set(
			installed.flatMap((entry) => (entry.server ? [entry.server] : [])),
		);
		const desktopIds = new Set(desktop.map((entry) => entry.id));
		const selectedServers = selected
			? (projectServers[available.indexOf(selected)] ?? [])
			: globalServers;
		const configuredMcps = selectedServers
			.filter((entry) => !desktopIds.has(entry.name) && !ownedServers.has(entry.name))
			.map((entry): MarketplaceIncludedItem => ({
				kind: "mcp",
				id: entry.name,
				name: entry.title ?? displayName(entry.name),
				description: "Configured in Kilo.",
				category: "Custom",
				installedIn: "Kilo",
			}));
		const desktopIncluded = desktop.map((entry): MarketplaceIncludedItem => ({
			kind: "mcp",
			id: entry.id,
			name: displayName(entry.id),
			description: "Provided by Anaconda Desktop.",
			category: "Built-in",
			installedIn: "Anaconda Desktop",
		}));
		const seen = new Set(owned);
		const included = [
			...runtime.configured,
			...configuredMcps,
			...runtime.builtIn,
			...desktopIncluded,
		].filter((entry) => {
			const key = `${entry.kind}:${entry.id}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		return {
			items: listed.items,
			targets: available,
			installed,
			included,
			errors: [...new Set(listed.errors)],
			stale: listed.stale,
			fetchedAt: Date.now(),
		};
	};

	const preview = async (location: KiloLocation, input: MarketplacePreviewInput) =>
		location.preview({
			...input.item,
			scope: input.scope,
			...(input.option ? { option: input.option } : {}),
			...(input.params && Object.keys(input.params).length ? { params: input.params } : {}),
		});

	/**
	 * An MCP install launches whatever Kilo builds from the catalog, so the
	 * person's confirmation is bound to the entry Kilo previewed for them. If Kilo
	 * would now write anything else, the install is refused rather than running a
	 * command the person never saw.
	 */
	const assertReviewed = async (location: KiloLocation, input: MarketplaceInstallInput) => {
		if (input.reviewed === undefined) {
			throw new KernelError("BUSINESS", "Review this MCP’s configuration before installing it.");
		}
		const current = await preview(location, input);
		if (current.server !== input.reviewed) {
			throw new KernelError(
				"BUSINESS",
				"This MCP’s configuration changed since you reviewed it. Check the updated configuration, then install again.",
			);
		}
	};

	const signIn = async (location: KiloLocation, serverName: string) => {
		const servers = await location.mcpServers();
		const server = servers.find((entry) => entry.name === serverName);
		if (!server) throw new KernelError("NOT_FOUND", "Kilo doesn't know this MCP server.");
		const integration = server.integrationID
			? await location.integration(server.integrationID)
			: undefined;
		const method = integration?.methods.find((entry) => entry.type === "oauth");
		if (!integration || !method || method.type !== "oauth") {
			throw new KernelError("BUSINESS", "This MCP server has no sign-in Kilo can start.");
		}
		const attempt = await location.startOAuth(integration.id, method.id);
		if (attempt.mode !== "auto") {
			await location.cancelOAuth(integration.id, attempt.attemptID).catch(() => undefined);
			throw new KernelError(
				"BUSINESS",
				"This MCP server's sign-in needs a code Desktop can't take.",
			);
		}
		if (!(await deps.openExternal(attempt.url))) {
			await location.cancelOAuth(integration.id, attempt.attemptID).catch(() => undefined);
			throw new KernelError("BUSINESS", "Could not open the sign-in page in your browser.");
		}
		await waitForSignIn(location, integration.id, attempt.attemptID);
	};

	const waitForSignIn = async (
		location: KiloLocation,
		integrationID: string,
		attemptID: string,
	) => {
		const pollMs = deps.signInPollMs ?? SIGN_IN_POLL_MS;
		for (;;) {
			// Polling is sequential by nature: each answer decides whether to ask again.
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
			const status = await location.oauthStatus(integrationID, attemptID);
			if (status.status === "complete") return;
			if (status.status === "failed") throw new KernelError("BUSINESS", status.message);
			if (status.status === "expired") {
				throw new KernelError("BUSINESS", "MCP sign-in expired before it finished.");
			}
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
			await new Promise((resolve) => setTimeout(resolve, pollMs));
		}
	};

	return {
		list: ({ workspaceId }) => snapshot(workspaceId, false).catch(operationError),
		refresh: ({ workspaceId }) => snapshot(workspaceId, true).catch(operationError),
		preview: async (input) => {
			try {
				const location = await destination(input);
				const { server, config, secrets } = await preview(location, input);
				return { server, config, secrets: [...secrets] };
			} catch (error) {
				return operationError(error);
			}
		},
		install: async (input) => {
			try {
				const location = await destination(input);
				if (input.item.kind === "mcp") await assertReviewed(location, input);
				await location.install({
					...input.item,
					scope: input.scope,
					...(input.option ? { option: input.option } : {}),
					...(input.params && Object.keys(input.params).length ? { params: input.params } : {}),
				});
				return { ok: true as const };
			} catch (error) {
				return operationError(error);
			}
		},
		remove: async (input) => {
			try {
				const location = await destination(input);
				await location.uninstall({ ...input.item, scope: input.scope });
				return { ok: true as const };
			} catch (error) {
				return operationError(error);
			}
		},
		authenticateMcp: async ({ server, workspaceId }) => {
			try {
				const location = await destination(
					workspaceId ? { scope: "project", workspaceId } : { scope: "global" },
				);
				await signIn(location, server);
				return { ok: true as const };
			} catch (error) {
				return operationError(error);
			}
		},
		// The Kilo server inherits Desktop's PATH (reserved from config overrides), so
		// resolving here predicts whether Kilo can spawn a local MCP's launch command.
		checkCommands: async ({ commands }) => {
			const resolve = deps.which ?? ((command: string) => which.sync(command, { nothrow: true }));
			const onPath = (command: string) => resolve(command) !== null;
			return {
				missing: commands
					.filter((command) => !onPath(command))
					.map((command) => ({
						command,
						installCommands: installCommands(command, deps.platform ?? process.platform, onPath),
					})),
			};
		},
	};
}

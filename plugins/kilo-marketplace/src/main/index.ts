import {
	marketplaceContract,
	type MarketplaceIncludedItem,
	type MarketplaceInstalled,
	marketplaceMcpStatusSchema,
	type MarketplaceMcpStatus,
	type MarketplaceMutationInput,
	type MarketplaceService,
	type MarketplaceTarget,
} from "../contracts/schemas.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import {
	CliMarketplaceClient,
	CliMarketplaceError,
	type KiloConnection,
} from "./cli-marketplace.js";
import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk/main";

type Workspace = {
	id: string;
	name: string;
	color?: string;
	folders: Array<{ path: string; isPrimary: boolean }>;
};

type KiloUiCapabilities = {
	workspaceService: {
		list(): Promise<Workspace[]>;
		get(id: string): Promise<Workspace | null>;
	};
};

type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloConnection>;
	};
	kiloService: {
		mcpConfig: {
			list?(): Promise<Array<{ id: string; sourceId: string }>>;
		};
	};
};

const runtimeSkillsSchema = z.array(
	z.object({
		name: z.string().min(1),
		description: z.string().nullish(),
		location: z.string(),
		content: z.string().nullish(),
	}),
);

const runtimeAgentsSchema = z.array(
	z.object({
		name: z.string().min(1),
		displayName: z.string().nullish(),
		description: z.string().nullish(),
		native: z.boolean().nullish(),
		hidden: z.boolean().nullish(),
		source: z.string().nullish(),
	}),
);

const compatibilitySkillPath = /(?:^|[/\\])\.(?:claude|agents)[/\\]skills(?:[/\\]|$)/;

function isCompatibilitySkill(location: string): boolean {
	return compatibilitySkillPath.test(location);
}

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

async function skillDescription(
	skill: z.infer<typeof runtimeSkillsSchema>[number],
): Promise<string | undefined> {
	const description = skill.description?.trim();
	if (description) return description;
	const embedded = frontmatterDescription(skill.content ?? undefined);
	if (embedded) return embedded;
	if (skill.location === "builtin") return undefined;
	const manifest = await readFile(skill.location, "utf8").catch(() => undefined);
	return frontmatterDescription(manifest);
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

function operationError(error: unknown): never {
	if (error instanceof FeatureError) throw error;
	if (error instanceof CliMarketplaceError) {
		throw new FeatureError(error.message, "BUSINESS");
	}
	throw error;
}

/**
 * Marketplace registration adapts Kilo's Marketplace HTTP API to Desktop's
 * multi-workspace view. Kilo owns catalog, detection, and mutation; Desktop
 * enriches those results with workspace identity, runtime inventory/status,
 * and Desktop-managed MCPs.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const kilo = (): KiloServerCapabilities => {
		const capability = mainSdk.plugins.get<KiloServerCapabilities>("kilo-server");
		if (!capability) throw new FeatureError("Kilo Server is unavailable.", "BUSINESS");
		return capability;
	};
	const workspaces = (): KiloUiCapabilities["workspaceService"] | null =>
		mainSdk.plugins.get<KiloUiCapabilities>("kilo-ui")?.workspaceService ?? null;
	const targets = async (): Promise<MarketplaceTarget[]> => {
		const service = workspaces();
		if (!service) return [];
		return (await service.list()).flatMap((workspace) => {
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
	};
	const resolveWorkspace = async (workspaceId: string | undefined): Promise<MarketplaceTarget> => {
		if (!workspaceId) {
			throw new FeatureError("Select a workspace before continuing.", "BUSINESS");
		}
		const workspace = await workspaces()?.get(workspaceId);
		const primary = workspace?.folders.find((folder) => folder.isPrimary);
		if (!workspace || !primary) {
			throw new FeatureError("Workspace not found.", "NOT_FOUND");
		}
		return {
			id: workspace.id,
			name: workspace.name,
			directory: primary.path,
			...(workspace.color ? { color: workspace.color } : {}),
		};
	};
	const runtimeItems = async (
		selected: MarketplaceTarget | undefined,
	): Promise<{
		included: MarketplaceIncludedItem[];
		configured: MarketplaceInstalled[];
		compatibilitySkillIds: ReadonlySet<string>;
	}> => {
		try {
			const connection = await kilo().connectionService.getConnection();
			const agentUrl = new URL("/agent", connection.baseUrl);
			const skillUrl = new URL("/skill", connection.baseUrl);
			if (selected) {
				agentUrl.searchParams.set("directory", selected.directory);
				skillUrl.searchParams.set("directory", selected.directory);
			}
			const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
				"base64",
			);
			const [agentResponse, skillResponse] = await Promise.all([
				mainSdk.net.fetch(agentUrl, {
					headers: { authorization: `Basic ${authorization}` },
				}),
				mainSdk.net.fetch(skillUrl, {
					headers: { authorization: `Basic ${authorization}` },
				}),
			]);
			if (!agentResponse.ok) throw new Error(`Kilo agents returned ${agentResponse.status}.`);
			if (!skillResponse.ok) throw new Error(`Kilo skills returned ${skillResponse.status}.`);
			const runtimeAgents = runtimeAgentsSchema
				.parse(await agentResponse.json())
				.filter((agent) => agent.hidden !== true);
			const agents = runtimeAgents
				.filter((agent) => agent.native === true)
				.map((agent) => ({
					type: "agent" as const,
					id: agent.name,
					name: agent.displayName ?? displayName(agent.name),
					description: agent.description ?? "Included with Kilo.",
					category: "Built-in",
					installedIn: "Kilo",
				}));
			const configuredAgents = runtimeAgents
				.filter((agent) => agent.native !== true)
				.map((agent) => ({
					type: "agent" as const,
					id: agent.name,
					scope: "global" as const,
					name: agent.displayName ?? displayName(agent.name),
					description: agent.description ?? "Configured in Kilo.",
					category: agent.source === "organization" ? "Organization" : "Custom",
					installedIn: agent.source === "organization" ? "Organization" : "Kilo",
				}));
			const runtimeSkills = runtimeSkillsSchema.parse(await skillResponse.json());
			const runtimeSkillsWithDescriptions = await Promise.all(
				runtimeSkills.map(async (skill) => ({
					skill,
					description: await skillDescription(skill),
				})),
			);
			const skills = runtimeSkillsWithDescriptions
				.filter(({ skill }) => skill.location === "builtin")
				.map(({ skill, description }) => ({
					type: "skill" as const,
					id: skill.name,
					name: displayName(skill.name),
					description: description ?? "Included with Kilo.",
					category: "Built-in",
					installedIn: "Kilo",
				}));
			const configuredSkills = runtimeSkillsWithDescriptions
				.filter(
					({ skill }) => skill.location !== "builtin" && !isCompatibilitySkill(skill.location),
				)
				.map(({ skill, description }) => ({
					type: "skill" as const,
					id: skill.name,
					scope: "global" as const,
					name: displayName(skill.name),
					description: description ?? "Configured in Kilo.",
					category: "Custom",
					installedIn: "Kilo",
				}));
			const compatibilitySkillIds = new Set(
				runtimeSkills
					.filter((skill) => isCompatibilitySkill(skill.location))
					.map((skill) => skill.name),
			);
			return {
				included: [...agents, ...skills],
				configured: [...configuredAgents, ...configuredSkills],
				compatibilitySkillIds,
			};
		} catch (error) {
			mainSdk.logger.warn("Could not list runtime Kilo inventory.", { error });
			return { included: [], configured: [], compatibilitySkillIds: new Set() };
		}
	};
	const mcpStatuses = async (
		selected: MarketplaceTarget | undefined,
	): Promise<Record<string, MarketplaceMcpStatus>> => {
		try {
			const connection = await kilo().connectionService.getConnection();
			const url = new URL("/mcp", connection.baseUrl);
			if (selected) url.searchParams.set("directory", selected.directory);
			const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
				"base64",
			);
			const response = await mainSdk.net.fetch(url, {
				headers: { authorization: `Basic ${authorization}` },
			});
			if (!response.ok) throw new Error(`Kilo MCP status returned ${response.status}.`);
			return z.record(z.string(), marketplaceMcpStatusSchema).parse(await response.json());
		} catch (error) {
			mainSdk.logger.warn("Could not read Kilo MCP status.", { error });
			return {};
		}
	};
	const mcpLocationStatuses = async (availableTargets: MarketplaceTarget[]) => {
		const [global, ...workspaces] = await Promise.all([
			mcpStatuses(undefined),
			...availableTargets.map(mcpStatuses),
		]);
		return {
			global: global ?? {},
			workspaces: availableTargets.map((target, index) => ({
				target,
				statuses: workspaces[index] ?? {},
			})),
		};
	};
	const mcpInstallationStatuses = (
		locations: Awaited<ReturnType<typeof mcpLocationStatuses>>,
	): Record<string, MarketplaceMcpStatus> =>
		Object.fromEntries(
			[
				["global", locations.global] as const,
				...locations.workspaces.map(({ target, statuses }) => [target.id, statuses] as const),
			].flatMap(([location, statuses]) =>
				Object.entries(statuses).map(([id, status]) => [`${id}:${location}`, status]),
			),
		);
	const desktopMcps = async (): Promise<Array<{ id: string; sourceId: string }>> => {
		const list = kilo().kiloService.mcpConfig.list;
		if (!list) return [];
		try {
			return await list();
		} catch (error) {
			mainSdk.logger.warn("Could not list Desktop-managed MCPs.", { error });
			return [];
		}
	};

	const cli = async () => {
		const connection = await kilo().connectionService.getConnection();
		return { connection, client: new CliMarketplaceClient(connection, mainSdk.net.fetch) };
	};
	const route = async (input: MarketplaceMutationInput, connection: KiloConnection) =>
		input.scope === "workspace"
			? (await resolveWorkspace(input.workspaceId)).directory
			: connection.globalDirectory;

	const snapshot = async (workspaceId: string | undefined) => {
		const [availableTargets, { connection, client }] = await Promise.all([targets(), cli()]);
		const selected = workspaceId
			? availableTargets.find((target) => target.id === workspaceId)
			: undefined;
		const listTargets =
			availableTargets.length > 0
				? availableTargets
				: [{ id: "global", name: "Global", directory: connection.globalDirectory }];
		const [firstTarget, ...remainingTargets] = listTargets;
		const firstList = { target: firstTarget!, result: await client.list(firstTarget!.directory) };
		const [lists, runtime, locationStatuses, desktopEntries] = await Promise.all([
			Promise.all(
				remainingTargets.map(async (target) => ({
					target,
					result: await client.list(target.directory),
				})),
			).then((remaining) => [firstList, ...remaining]),
			runtimeItems(selected),
			mcpLocationStatuses(availableTargets),
			desktopMcps(),
		]);
		const catalogSnapshot = lists[0]!.result;
		const globalInstallations = catalogSnapshot.global.map((entry): MarketplaceInstalled => ({
			...entry,
			scope: "global",
		}));
		const workspaceInstallations = lists.flatMap(({ target, result }) =>
			target.id === "global"
				? []
				: result.project.map((entry): MarketplaceInstalled => ({
						...entry,
						scope: "workspace",
						workspaceId: target.id,
					})),
		);
		const discoveredInstallations = [...globalInstallations, ...workspaceInstallations].filter(
			(entry) => entry.type !== "skill" || !runtime.compatibilitySkillIds.has(entry.id),
		);
		const statuses = selected
			? (locationStatuses.workspaces.find(({ target }) => target === selected)?.statuses ?? {})
			: locationStatuses.global;
		const nativeAgentIds = new Set(
			runtime.included.filter((entry) => entry.type === "agent").map((entry) => entry.id),
		);
		const runtimeConfiguredById = new Map(
			runtime.configured.map((entry) => [`${entry.type}:${entry.id}`, entry]),
		);
		const installed = discoveredInstallations
			.filter((entry) => entry.type !== "agent" || !nativeAgentIds.has(entry.id))
			.map((entry) => {
				const runtimeEntry = runtimeConfiguredById.get(`${entry.type}:${entry.id}`);
				return runtimeEntry
					? {
							...entry,
							name: entry.name ?? runtimeEntry.name,
							description: entry.description ?? runtimeEntry.description,
							category: entry.category ?? runtimeEntry.category,
							installedIn: entry.installedIn ?? runtimeEntry.installedIn,
						}
					: entry;
			});
		const desktopIds = new Set(desktopEntries.map((entry) => entry.id));
		const configured = [
			...runtime.configured,
			...Object.keys(statuses)
				.filter((id) => !desktopIds.has(id))
				.map((id): MarketplaceInstalled => ({
					type: "mcp",
					id,
					scope: "global",
					name: displayName(id),
					description: "Configured in Kilo.",
					category: "Custom",
					installedIn: "Kilo",
				})),
		];
		const desktopIncluded = desktopEntries.map((entry): MarketplaceIncludedItem => ({
			type: "mcp",
			id: entry.id,
			name: displayName(entry.id),
			description: "Provided by Anaconda Desktop.",
			category: "Built-in",
			installedIn: "Anaconda Desktop",
		}));
		const discovered = new Set(installed.map((entry) => `${entry.type}:${entry.id}`));
		const runtimeIncluded = configured.flatMap((entry): MarketplaceIncludedItem[] => {
			const key = `${entry.type}:${entry.id}`;
			if (discovered.has(key)) return [];
			discovered.add(key);
			return [
				{
					type: entry.type,
					id: entry.id,
					name: entry.name ?? displayName(entry.id),
					description: entry.description ?? "Configured in Kilo.",
					category: entry.category ?? "Custom",
					installedIn: entry.installedIn ?? "Kilo",
				},
			];
		});
		const included = [...runtime.included, ...desktopIncluded].filter((entry) => {
			const key = `${entry.type}:${entry.id}`;
			if (discovered.has(key)) return false;
			discovered.add(key);
			return true;
		});
		return {
			items: catalogSnapshot.items,
			targets: availableTargets,
			installed,
			included: [...runtimeIncluded, ...included],
			mcpStatuses: statuses,
			mcpInstallationStatuses: mcpInstallationStatuses(locationStatuses),
			errors: [...new Set(lists.flatMap(({ result }) => result.errors))],
			stale: false,
			fetchedAt: Date.now(),
		};
	};

	const api: MarketplaceService = {
		"marketplace.list": ({ workspaceId }) => snapshot(workspaceId).catch(operationError),
		"marketplace.refresh": ({ workspaceId }) => snapshot(workspaceId).catch(operationError),
		"marketplace.install": async (input) => {
			try {
				const { connection, client } = await cli();
				const directory = await route(input, connection);
				const listed = await client.list(directory);
				const selected = listed.items.find(
					(candidate) => candidate.type === input.item.type && candidate.id === input.item.id,
				);
				if (!selected) {
					throw new FeatureError("Marketplace item is no longer available.", "NOT_FOUND");
				}
				const path = await client.install(
					directory,
					selected,
					input.scope === "workspace" ? "project" : "global",
					input.method,
					input.parameters,
				);
				return { ok: true, ...(path ? { path } : {}) };
			} catch (error) {
				return operationError(error);
			}
		},
		"marketplace.remove": async (input) => {
			try {
				const { connection, client } = await cli();
				const directory = await route(input, connection);
				await client.remove(
					directory,
					input.item,
					input.scope === "workspace" ? "project" : "global",
				);
				return { ok: true };
			} catch (error) {
				return operationError(error);
			}
		},
		"marketplace.authenticateMcp": async ({ id, workspaceId }) => {
			try {
				const [connection, selected] = await Promise.all([
					kilo().connectionService.getConnection(),
					workspaceId ? resolveWorkspace(workspaceId) : undefined,
				]);
				const url = new URL(`/mcp/${encodeURIComponent(id)}/auth/authenticate`, connection.baseUrl);
				if (selected) url.searchParams.set("directory", selected.directory);
				const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
					"base64",
				);
				const response = await mainSdk.net.fetch(url, {
					method: "POST",
					headers: { authorization: `Basic ${authorization}` },
				});
				if (!response.ok) {
					throw new FeatureError("Kilo could not start MCP sign-in.", "BUSINESS");
				}
				const status = marketplaceMcpStatusSchema.parse(await response.json());
				if (status.status === "failed" || status.status === "needs_client_registration") {
					throw new FeatureError(status.error, "BUSINESS");
				}
				return { ok: true };
			} catch (error) {
				return operationError(error);
			}
		},
	};

	mainSdk.channels(marketplaceContract).handleAll(api);
}

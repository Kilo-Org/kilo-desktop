import { KernelError, type DomainObjectMethods, type KernelLogger } from "@kilo-desktop/kernel";

import {
	type Marketplace,
	type MarketplaceIncludedItem,
	type MarketplaceInstalled,
	type MarketplaceMcpStatus,
	type MarketplaceMutationInput,
	type MarketplaceTarget,
	type McpMarketplaceItem,
} from "../contracts/index";
import { mcpInstallContent } from "../contracts/index";
import { installCommands } from "../contracts/index";
import which from "which";
import { parse as parseYaml } from "yaml";
import { createKiloV2MarketplaceApi, type KiloConnection } from "./kilo-v2-client";
import {
	KiloV2Marketplace,
	MarketplaceBackendError,
	type V2MarketplaceApi,
} from "./kilo-v2-marketplace";

export interface MarketplaceWorkspace {
	readonly id: string;
	readonly name: string;
	readonly color?: string | undefined;
	readonly folders: ReadonlyArray<{ readonly path: string; readonly isPrimary: boolean }>;
}

/** What the marketplace reads from the rest of the app (kilo.core, kilo.work-sessions). */
export interface MarketplaceDependencies {
	/** How to reach Kilo's server; rejects while it is unavailable. */
	readonly connect: () => Promise<KiloConnection>;
	/** The registered workspaces; null without kilo.work-sessions. */
	readonly workspaces: () => readonly MarketplaceWorkspace[] | null;
	/** MCP servers the app itself adds to Kilo (`kilo.core/mcp-server`). */
	readonly desktopMcps: () => Promise<ReadonlyArray<{ readonly id: string }>>;
	readonly fetch: typeof globalThis.fetch;
	/** Opens a URL in the browser (MCP sign-in). */
	readonly openExternal: (url: string) => Promise<unknown>;
	/** Kilo v2's API for a connection; tests pass an in-memory one. */
	readonly api?: (connection: KiloConnection) => V2MarketplaceApi;
	readonly logger: KernelLogger;
	/** Resolves a bare command on PATH (`which`); null when missing. */
	readonly which?: (command: string) => string | null;
	readonly platform?: NodeJS.Platform;
}

export type MarketplaceApi = DomainObjectMethods<typeof Marketplace>;

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

function skillDescription(skill: {
	description?: string | undefined;
	content: string;
}): string | undefined {
	return skill.description?.trim() || frontmatterDescription(skill.content);
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

/**
 * An MCP install launches whatever its catalog template says, so the user's confirmation is bound
 * to the exact template the dialog showed. The catalog is re-read at install time; if it now holds
 * anything else, the install is refused rather than running a command the user never saw.
 */
function assertReviewed(item: McpMarketplaceItem, input: MarketplaceMutationInput): void {
	if (input.reviewedContent === undefined) {
		throw new KernelError("BUSINESS", "Review this MCP’s configuration before installing it.");
	}
	if (mcpInstallContent(item, input.method) !== input.reviewedContent) {
		throw new KernelError(
			"BUSINESS",
			"This MCP’s configuration changed since you reviewed it. Check the updated configuration, then install again.",
		);
	}
}

function operationError(error: unknown): never {
	if (error instanceof KernelError) throw error;
	if (error instanceof MarketplaceBackendError) throw new KernelError("BUSINESS", error.message);
	throw error;
}

/**
 * The marketplace adapts Kilo v2's Marketplace RPCs (`kilo-v2-marketplace.ts`)
 * to Desktop's multi-workspace view. Kilo owns catalog, detection, and mutation; Desktop
 * enriches those results with workspace identity, runtime inventory/status,
 * Desktop-managed MCPs, and whether MCP launch commands resolve on PATH (Kilo
 * installs without checking). Global inventory is read from the mutation context
 * because Kilo invalidates discovery per directory.
 */
export function createMarketplaceApi(deps: MarketplaceDependencies): MarketplaceApi {
	const targets = async (): Promise<MarketplaceTarget[]> => {
		const listed = deps.workspaces();
		if (!listed) return [];
		return listed.flatMap((workspace) => {
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
			throw new KernelError("BUSINESS", "Select a workspace before continuing.");
		}
		const workspace = deps.workspaces()?.find((candidate) => candidate.id === workspaceId);
		const primary = workspace?.folders.find((folder) => folder.isPrimary);
		if (!workspace || !primary) {
			throw new KernelError("NOT_FOUND", "Workspace not found.");
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
			const { connection, client } = await cli();
			const runtime = await client.runtime(selected?.directory ?? connection.globalDirectory);
			const agents = runtime.agents
				.filter((agent) => !agent.configured)
				.map((agent) => ({
					type: "agent" as const,
					id: agent.id,
					name: agent.name || displayName(agent.id),
					description: agent.description ?? "Included with Kilo.",
					category: "Built-in",
					installedIn: "Kilo",
				}));
			const configuredAgents = runtime.agents
				.filter((agent) => agent.configured)
				.map((agent) => ({
					type: "agent" as const,
					id: agent.id,
					scope: "global" as const,
					name: agent.name || displayName(agent.id),
					description: agent.description ?? "Configured in Kilo.",
					category: "Custom",
					installedIn: "Kilo",
				}));
			const skills = runtime.skills
				.filter((skill) => skill.location === "builtin")
				.map((skill) => ({
					type: "skill" as const,
					id: skill.id,
					name: displayName(skill.id),
					description: skillDescription(skill) ?? "Included with Kilo.",
					category: "Built-in",
					installedIn: "Kilo",
				}));
			const configuredSkills = runtime.skills
				.filter((skill) => skill.location !== "builtin" && !isCompatibilitySkill(skill.location))
				.map((skill) => ({
					type: "skill" as const,
					id: skill.id,
					scope: "global" as const,
					name: displayName(skill.id),
					description: skillDescription(skill) ?? "Configured in Kilo.",
					category: "Custom",
					installedIn: "Kilo",
				}));
			const runtimeSkills = runtime.skills.map((skill) => ({
				name: skill.id,
				location: skill.location,
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
			deps.logger.warn("Could not list runtime Kilo inventory.", { error });
			return { included: [], configured: [], compatibilitySkillIds: new Set() };
		}
	};
	const mcpStatuses = async (
		selected: MarketplaceTarget | undefined,
	): Promise<Record<string, MarketplaceMcpStatus>> => {
		try {
			const { connection, client } = await cli();
			return await client.mcpStatuses(selected?.directory ?? connection.globalDirectory);
		} catch (error) {
			deps.logger.warn("Could not read Kilo MCP status.", { error });
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
	const desktopMcps = async (): Promise<ReadonlyArray<{ readonly id: string }>> => {
		try {
			return await deps.desktopMcps();
		} catch (error) {
			deps.logger.warn("Could not list Desktop-managed MCPs.", { error });
			return [];
		}
	};

	const cli = async () => {
		const connection = await deps.connect();
		const api = (deps.api ?? ((value) => createKiloV2MarketplaceApi(value, deps.fetch)))(
			connection,
		);
		return { connection, client: new KiloV2Marketplace(api) };
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
		const [catalogSnapshot, lists, runtime, locationStatuses, desktopEntries] = await Promise.all([
			client.list(connection.globalDirectory),
			Promise.all(
				availableTargets.map(async (target) => ({
					target,
					result: await client.list(target.directory),
				})),
			),
			runtimeItems(selected),
			mcpLocationStatuses(availableTargets),
			desktopMcps(),
		]);
		const globalInstallations = catalogSnapshot.global.map((entry): MarketplaceInstalled => ({
			...entry,
			scope: "global",
		}));
		const workspaceInstallations = lists.flatMap(({ target, result }) =>
			result.project.map((entry): MarketplaceInstalled => ({
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
			errors: [
				...new Set([...catalogSnapshot.errors, ...lists.flatMap(({ result }) => result.errors)]),
			],
			stale: false,
			fetchedAt: Date.now(),
		};
	};

	return {
		list: ({ workspaceId }) => snapshot(workspaceId).catch(operationError),
		refresh: ({ workspaceId }) => snapshot(workspaceId).catch(operationError),
		install: async (input) => {
			try {
				const { connection, client } = await cli();
				const directory = await route(input, connection);
				const listed = await client.list(directory);
				const selected = listed.items.find(
					(candidate) => candidate.type === input.item.type && candidate.id === input.item.id,
				);
				if (!selected) {
					throw new KernelError("NOT_FOUND", "Marketplace item is no longer available.");
				}
				if (selected.type === "mcp") assertReviewed(selected, input);
				const path = await client.install(
					directory,
					selected,
					input.scope === "workspace" ? "project" : "global",
					input.method,
					input.parameters,
				);
				return { ok: true as const, ...(path ? { path } : {}) };
			} catch (error) {
				return operationError(error);
			}
		},
		remove: async (input) => {
			try {
				const { connection, client } = await cli();
				const directory = await route(input, connection);
				await client.remove(
					directory,
					input.item,
					input.scope === "workspace" ? "project" : "global",
				);
				return { ok: true as const };
			} catch (error) {
				return operationError(error);
			}
		},
		authenticateMcp: async ({ id, workspaceId }) => {
			try {
				const [{ connection, client }, selected] = await Promise.all([
					cli(),
					workspaceId ? resolveWorkspace(workspaceId) : undefined,
				]);
				await client.authenticateMcp(
					selected?.directory ?? connection.globalDirectory,
					id,
					deps.openExternal,
				);
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

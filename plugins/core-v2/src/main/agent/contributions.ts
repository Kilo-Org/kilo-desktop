import path from "node:path";

import type { AnyExtensionPoint, Contribution, PluginSdk } from "@kilo-desktop/kernel";

import {
	AgentExtension,
	AiProviderPoint,
	McpServer,
	modelKey,
	ServerEnv,
	type AgentExtensionConfig,
	type McpServerEntry,
} from "../../contracts";
import type { ContributedEnvManager } from "./ContributedEnvManager";
import type { KiloConfigEntry, KiloConfigManager } from "./KiloConfigManager";
import type { KiloConfiguration } from "./KiloConfiguration";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface ContributionTracker {
	/** Starts following the extension point (first call) and settles once every apply queued so far ran. */
	reconcile(): Promise<void>;
	dispose(): void;
}

/**
 * Applies each contribution to an extension point and re-applies it when its
 * implementation says it changed (`subscribe`) or is replaced; a removed
 * contribution is applied once more with `removed` so its effects are
 * withdrawn. Applies are serialized; nothing is applied before `reconcile`.
 */
export function trackContributions<TPoint extends AnyExtensionPoint>(
	sdk: PluginSdk,
	point: TPoint,
	apply: (contribution: Contribution<TPoint>, removed: boolean) => Promise<void>,
): ContributionTracker {
	const known = new Map<
		string,
		{ contribution: Contribution<TPoint>; implementation: unknown; stop?: () => void }
	>();
	let queue = Promise.resolve();
	let started = false;
	const applyOne = (contribution: Contribution<TPoint>, removed: boolean) => {
		queue = queue
			.then(() => apply(contribution, removed))
			.catch((error) => sdk.logger.warn(errorText(error)));
		return queue;
	};

	const reconcile = () => {
		started = true;
		const current = sdk.extensions.list(point);
		const byKey = new Map<string, Contribution<TPoint>>(
			current.map((contribution) => [contribution.key, contribution]),
		);
		for (const [key, entry] of known) {
			const present = byKey.get(key);
			if (present && present.implementation === entry.implementation) continue;
			entry.stop?.();
			known.delete(key);
			if (!present) void applyOne(entry.contribution, true);
		}
		for (const contribution of current) {
			if (known.has(contribution.key)) continue;
			const implementation = contribution.implementation;
			const stop = (
				implementation as { subscribe?: (onChange: () => void) => () => void } | undefined
			)?.subscribe?.(() => void applyOne(contribution, false));
			known.set(contribution.key, { contribution, implementation, ...(stop ? { stop } : {}) });
			void applyOne(contribution, false);
		}
		return queue;
	};

	const unsubscribe = sdk.extensions.subscribe(point, () => {
		if (started) void reconcile();
	});
	return {
		reconcile,
		dispose() {
			unsubscribe();
			for (const entry of known.values()) entry.stop?.();
			known.clear();
		},
	};
}

/**
 * `kilo.core/ai-provider` contributions: each entry is written to the
 * app-owned Kilo config, owned by its plugin (a write asks the server to
 * restart), and its env joins the server's spawn environment, keyed by the
 * contribution (a change restarts a running server whose env differs).
 */
export function trackAiProviders(
	sdk: PluginSdk,
	options: {
		readonly kiloConfig: Pick<KiloConfigManager, "setProviderEntry" | "removeProviderEntry">;
		readonly contributedEnv: ContributedEnvManager;
		readonly onConfigChanged: () => void;
	},
): ContributionTracker {
	const releaseEnv = new Map<string, () => void>();
	return trackContributions(sdk, AiProviderPoint, async (contribution, removed) => {
		const aiProviderId = contribution.metadata.aiProviderId;
		const config = removed ? undefined : contribution.implementation?.read();
		const outcome = config
			? await options.kiloConfig.setProviderEntry(contribution.pluginId, aiProviderId, config.entry)
			: await options.kiloConfig.removeProviderEntry(contribution.pluginId, aiProviderId);
		if (outcome.kind === "written" || outcome.kind === "removed") options.onConfigChanged();
		else if (outcome.kind === "skipped-error" || outcome.reason !== "up-to-date")
			sdk.logger.warn(`Did not write AI provider "${aiProviderId}": ${outcome.reason}.`);
		// Config first: an env change restarts the server, which must read this config.
		releaseEnv.get(contribution.key)?.();
		releaseEnv.delete(contribution.key);
		if (config?.env) {
			releaseEnv.set(
				contribution.key,
				options.contributedEnv.contribute(contribution.key, { ...config.env }),
			);
		}
	});
}

/**
 * `kilo.core/server-env` contributions: each one's variables join the
 * server's spawn environment, keyed by the contribution, and leave with it
 * (a change restarts a running server whose env differs).
 */
export function trackServerEnv(
	sdk: PluginSdk,
	options: { readonly contributedEnv: ContributedEnvManager },
): ContributionTracker {
	const release = new Map<string, () => void>();
	return trackContributions(sdk, ServerEnv, async (contribution, removed) => {
		release.get(contribution.key)?.();
		release.delete(contribution.key);
		const env = removed ? undefined : contribution.implementation?.read();
		if (env && Object.keys(env).length > 0) {
			release.set(
				contribution.key,
				options.contributedEnv.contribute(contribution.key, { ...env }),
			);
		}
	});
}

const RESOURCES_TOKEN = "${resources}";
const UNRESOLVED_RESOURCES = "the host could not resolve ${resources} for its plugin";

/** Whether any string in `value`, at any depth, still holds `${resources}`. */
function hasUnresolvedResources(value: unknown): boolean {
	if (typeof value === "string") return value.includes(RESOURCES_TOKEN);
	if (value !== null && typeof value === "object") {
		return Object.values(value).some(hasUnresolvedResources);
	}
	return false;
}

/**
 * A static `kilo.core/mcp-server` contribution as Kilo's `mcp` entry. The
 * kernel has already put the contributor's own resources folder in place of
 * `${resources}`; one still there means its host had no assets to resolve it
 * with, so the server is skipped rather than written broken.
 */
export function staticMcpEntry(metadata: Contribution<typeof McpServer>["metadata"]): {
	entry?: McpServerEntry;
	problem?: string;
} {
	if (!metadata.command) return { problem: "it names no command and implements no source" };
	if (hasUnresolvedResources(metadata)) return { problem: UNRESOLVED_RESOURCES };
	return {
		entry: {
			type: "local",
			command: [metadata.command, ...metadata.args],
			...(metadata.env ? { environment: { ...metadata.env } } : {}),
			enabled: true,
		},
	};
}

/** What one `kilo.core/agent-extension` puts into Kilo, or why it can't. */
export type AgentExtensionEffect =
	| { readonly plugin: string }
	| { readonly skill: string }
	| { readonly agent: KiloConfigEntry }
	| { readonly command: KiloConfigEntry }
	| { readonly problem: string };

/**
 * An agent extension as Kilo takes it, in the field names of Kilo's config
 * schema (`agent` and `command` entries, models as `<provider>/<model>`); a
 * Kilo plugin (its v2 build's folder, `v2Path`) or a skill is at an absolute
 * path, which the kernel made by resolving `${resources}`.
 */
export function agentExtensionOf(metadata: AgentExtensionConfig): AgentExtensionEffect {
	if (hasUnresolvedResources(metadata)) return { problem: UNRESOLVED_RESOURCES };
	switch (metadata.type) {
		case "kilo-plugin": {
			// The Kilo v2 server line loads only the plugin's v2 build, a folder.
			if (metadata.v2Path === undefined) {
				return { problem: "it has no Kilo v2 build (v2Path)" };
			}
			if (!path.isAbsolute(metadata.v2Path)) {
				return { problem: 'its v2Path must be absolute (start it with "${resources}/")' };
			}
			return { plugin: metadata.v2Path };
		}
		case "skill": {
			if (!path.isAbsolute(metadata.path)) {
				return { problem: 'its path must be absolute (start it with "${resources}/")' };
			}
			return { skill: metadata.path };
		}
		case "agent":
			return {
				agent: {
					description: metadata.description,
					prompt: metadata.prompt,
					mode: metadata.mode,
					...(metadata.model ? { model: modelKey(metadata.model) } : {}),
				},
			};
		case "command":
			return {
				command: {
					template: metadata.template,
					...(metadata.description !== undefined ? { description: metadata.description } : {}),
					...(metadata.agent !== undefined ? { agent: metadata.agent } : {}),
					...(metadata.model ? { model: modelKey(metadata.model) } : {}),
					...(metadata.subtask !== undefined ? { subtask: metadata.subtask } : {}),
				},
			};
	}
}

interface SourceState {
	readonly mcpEntries: Map<string, McpServerEntry>;
	readonly agents: Map<string, KiloConfigEntry>;
	readonly commands: Map<string, KiloConfigEntry>;
	readonly plugins: Map<string, string>;
	readonly skills: Map<string, string>;
}

const emptySourceState = (): SourceState => ({
	mcpEntries: new Map(),
	agents: new Map(),
	commands: new Map(),
	plugins: new Map(),
	skills: new Map(),
});

/** Withdraws agent extension `id` from a source's state and puts `effect` in its place. */
function placeAgentExtension(
	state: SourceState,
	id: string,
	effect: Exclude<AgentExtensionEffect, { problem: string }> | undefined,
): void {
	for (const part of [state.plugins, state.skills, state.agents, state.commands]) part.delete(id);
	if (!effect) return;
	if ("plugin" in effect) state.plugins.set(id, effect.plugin);
	else if ("skill" in effect) state.skills.set(id, effect.skill);
	else if ("agent" in effect) state.agents.set(id, effect.agent);
	else state.commands.set(id, effect.command);
}

/**
 * `kilo.core/mcp-server` and `kilo.core/agent-extension` contributions,
 * written to Kilo as each contributing plugin's complete desired state
 * (`KiloConfiguration` owns them per plugin, so one plugin never touches
 * another's or the user's). Everything is keyed by contribution id: MCP
 * servers, agents and commands as Kilo config entries, Kilo plugins as
 * Desktop-managed plugin modules, skills as links in the app-owned config
 * directory's `skills/`. A contribution that can't be applied is skipped
 * with one warning.
 */
export function trackKiloExtensions(
	sdk: PluginSdk,
	options: { readonly configuration: Pick<KiloConfiguration, "set"> },
): { readonly mcpServers: ContributionTracker; readonly agentExtensions: ContributionTracker } {
	const bySource = new Map<string, SourceState>();
	const warned = new Set<string>();
	const warnOnce = (message: string) => {
		if (warned.has(message)) return;
		warned.add(message);
		sdk.logger.warn(message);
	};
	const stateOf = (pluginId: string) => {
		let state = bySource.get(pluginId);
		if (!state) bySource.set(pluginId, (state = emptySourceState()));
		return state;
	};
	const write = (pluginId: string) => {
		const state = stateOf(pluginId);
		return options.configuration.set(pluginId, {
			mcpEntries: Object.fromEntries(state.mcpEntries),
			agents: Object.fromEntries(state.agents),
			commands: Object.fromEntries(state.commands),
			plugins: Object.fromEntries(state.plugins),
			skills: Object.fromEntries(state.skills),
		});
	};

	const mcpServers = trackContributions(sdk, McpServer, async (contribution, removed) => {
		const { mcpEntries } = stateOf(contribution.pluginId);
		const entry = removed ? undefined : mcpEntryOf(contribution);
		if (entry) mcpEntries.set(contribution.id, entry);
		else mcpEntries.delete(contribution.id);
		await write(contribution.pluginId);
	});

	function mcpEntryOf(contribution: Contribution<typeof McpServer>): McpServerEntry | undefined {
		if (contribution.implementation) return contribution.implementation.read();
		const { entry, problem } = staticMcpEntry(contribution.metadata);
		if (problem) warnOnce(`Skipped MCP server "${contribution.key}": ${problem}.`);
		return entry;
	}

	const agentExtensions = trackContributions(sdk, AgentExtension, async (contribution, removed) => {
		const effect = removed ? undefined : agentExtensionOf(contribution.metadata);
		if (effect && "problem" in effect) {
			warnOnce(`Skipped agent extension "${contribution.key}": ${effect.problem}.`);
		}
		placeAgentExtension(
			stateOf(contribution.pluginId),
			contribution.id,
			effect && !("problem" in effect) ? effect : undefined,
		);
		await write(contribution.pluginId);
	});

	return { mcpServers, agentExtensions };
}

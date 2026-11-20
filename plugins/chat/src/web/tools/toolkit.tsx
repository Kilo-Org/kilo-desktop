import type { ToolCallMessagePartComponent, Toolkit } from "@assistant-ui/react";
import { memo, type ComponentType, type FC } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { toolWireName } from "@kilo-desktop/plugin-core/contracts";

import {
	McpApp,
	ToolRenderer,
	type ToolCategory,
	type ToolRendererImplementation,
} from "../../contracts";
import { setHostableMcpApps, type HostableMcpApp } from "../mcp-apps/mcp-app-registry";
import { toToolCallProps, type ToolCallProps } from "./tool-call";
import { setStandaloneToolCalls, type StandaloneToolCall } from "./standalone-tool-calls";
import { setContributedToolCategories } from "./tool-categories";
import { ToolCallFallback } from "./tool-ui-inline";

type RendererContribution = Contribution<typeof ToolRenderer>;

const selectComponent = (implementation: ToolRendererImplementation) => implementation.component;

/**
 * The name Kilo calls a `tools` entry by: a desktop tool's `kilo.core/tool`
 * contribution key (`kilo.terminal/open`) by its wire name, one of
 * Kilo's own tools (`bash`) as it is.
 */
export const toolNameOf = (tool: string): string =>
	tool.includes("/") ? toolWireName(tool) : tool;

/**
 * One tool's renderers, highest priority first: each is rendered inside its
 * own plugin's context and error boundary and handed the rest of the chain as
 * `Original`, ending in the one-line fallback.
 */
function rendererChain(
	contributions: readonly RendererContribution[],
	index = 0,
): ComponentType<ToolCallProps> {
	const contribution = contributions[index];
	if (!contribution) return ToolCallFallback;
	const Original = rendererChain(contributions, index + 1);
	const Rendered: FC<ToolCallProps> = (props) => (
		<RenderContribution
			contribution={contribution}
			props={{ ...props, Original }}
			select={selectComponent}
		/>
	);
	Rendered.displayName = `ToolRenderer(${contribution.key})`;
	return memo(Rendered);
}

/** A chain as the transcript's tool-call part renders it, handed kilo.chat's tool-call shape. */
function partRenderer(Chain: ComponentType<ToolCallProps>): ToolCallMessagePartComponent {
	const Part: ToolCallMessagePartComponent = (part) => <Chain {...toToolCallProps(part)} />;
	Part.displayName = Chain.displayName ?? "ToolRenderer";
	return memo(Part);
}

export interface ContributedTools {
	readonly toolkit: Toolkit;
	readonly categories: ReadonlyMap<string, ToolCategory>;
	/** Which calls stand alone, by tool, as the tool's first renderer says (`isStandalone`). */
	readonly standaloneCalls: ReadonlyMap<string, StandaloneToolCall>;
}

/** The transcript's render-only toolkit from `kilo.chat/tool-renderer` contributions. */
export function buildToolkit(contributions: readonly RendererContribution[]): ContributedTools {
	const byTool = new Map<string, RendererContribution[]>();
	const categories = new Map<string, ToolCategory>();
	for (const contribution of contributions) {
		if (!contribution.implementation) continue;
		for (const tool of contribution.metadata.tools.map(toolNameOf)) {
			const chain = byTool.get(tool) ?? [];
			chain.push(contribution);
			byTool.set(tool, chain);
			const category = contribution.metadata.category;
			if (category && !categories.has(tool)) categories.set(tool, category);
		}
	}
	// Execution stays on the server: these are backend tools with renderers
	// only (not `externalTool()`, which needs the "use generative" compiler).
	const toolkit: Toolkit = {};
	const standaloneCalls = new Map<string, StandaloneToolCall>();
	for (const [tool, chain] of byTool) {
		const first = chain[0]!;
		toolkit[tool] = {
			type: "backend",
			render: partRenderer(rendererChain(chain)),
			...(first.metadata.standalone ? { display: "standalone" as const } : {}),
		};
		const isStandalone = first.implementation?.isStandalone;
		if (isStandalone) standaloneCalls.set(tool, isStandalone);
	}
	return { toolkit, categories, standaloneCalls };
}

/**
 * The window's tool renderers as the thread's toolkit. Contributed
 * categories, per-call standalone questions and MCP Apps are window-wide (pure grouping helpers and the
 * patched projection read them), so they are published here too.
 */
export function useContributedToolkit(): Toolkit {
	const renderers = useExtensions(ToolRenderer);
	const apps = useExtensions(McpApp);
	return publishToolkit(renderers, apps);
}

/** The toolkit, publishing its categories, standalone calls and hostable MCP Apps window-wide on the way. */
function publishToolkit(
	renderers: readonly RendererContribution[],
	apps: readonly Contribution<typeof McpApp>[],
): Toolkit {
	const { toolkit, categories, standaloneCalls } = buildToolkit(renderers);
	setContributedToolCategories(categories);
	setStandaloneToolCalls(standaloneCalls);
	setHostableMcpApps(hostableMcpApps(apps));
	return toolkit;
}

export function hostableMcpApps(
	contributions: readonly Contribution<typeof McpApp>[],
): ReadonlyMap<string, HostableMcpApp> {
	const apps = new Map<string, HostableMcpApp>();
	for (const contribution of contributions) {
		for (const tool of contribution.metadata.tools.map(toolNameOf)) {
			if (apps.has(tool)) continue;
			apps.set(tool, {
				resourceUri: contribution.metadata.resourceUri,
				serverId: contribution.metadata.serverId,
				implementation: contribution.implementation,
			});
		}
	}
	return apps;
}

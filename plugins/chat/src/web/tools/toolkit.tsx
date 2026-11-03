import type { ToolCallMessagePartComponent, Toolkit } from "@assistant-ui/react";
import { memo, useMemo } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";

import {
	McpApp,
	ToolRenderer,
	type ToolCategory,
	type ToolRendererImplementation,
} from "../../contracts";
import { setHostableMcpApps, type HostableMcpApp } from "../mcp-apps/mcp-app-registry";
import { setContributedToolCategories } from "./tool-categories";
import { ToolCallFallback } from "./tool-ui-inline";

type RendererContribution = Contribution<typeof ToolRenderer>;

const selectComponent = (implementation: ToolRendererImplementation) => implementation.component;

/**
 * One tool's renderers, highest priority first: each is rendered inside its
 * own plugin's context and error boundary and handed the rest of the chain as
 * `Original`, ending in the one-line fallback.
 */
function rendererChain(
	contributions: readonly RendererContribution[],
	index = 0,
): ToolCallMessagePartComponent {
	const contribution = contributions[index];
	if (!contribution) return ToolCallFallback;
	const Original = rendererChain(contributions, index + 1);
	const Rendered: ToolCallMessagePartComponent = (props) => (
		<RenderContribution
			contribution={contribution}
			props={{ ...props, Original }}
			select={selectComponent}
		/>
	);
	Rendered.displayName = `ToolRenderer(${contribution.key})`;
	return memo(Rendered);
}

export interface ContributedTools {
	readonly toolkit: Toolkit;
	readonly categories: ReadonlyMap<string, ToolCategory>;
}

/** The transcript's render-only toolkit from `kilo.chat/tool-renderer` contributions. */
export function buildToolkit(contributions: readonly RendererContribution[]): ContributedTools {
	const byTool = new Map<string, RendererContribution[]>();
	const categories = new Map<string, ToolCategory>();
	for (const contribution of contributions) {
		if (!contribution.implementation) continue;
		for (const tool of contribution.metadata.tools) {
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
	for (const [tool, chain] of byTool) {
		toolkit[tool] = {
			type: "backend",
			render: rendererChain(chain),
			...(chain[0]!.metadata.standalone ? { display: "standalone" as const } : {}),
		};
	}
	return { toolkit, categories };
}

/**
 * The window's tool renderers as the thread's toolkit. Contributed
 * categories and MCP Apps are window-wide (pure grouping helpers and the
 * patched projection read them), so they are published here too.
 */
export function useContributedToolkit(): Toolkit {
	const renderers = useExtensions(ToolRenderer);
	const apps = useExtensions(McpApp);
	return useMemo(() => {
		const { toolkit, categories } = buildToolkit(renderers);
		setContributedToolCategories(categories);
		setHostableMcpApps(hostableMcpApps(apps));
		return toolkit;
	}, [renderers, apps]);
}

export function hostableMcpApps(
	contributions: readonly Contribution<typeof McpApp>[],
): ReadonlyMap<string, HostableMcpApp> {
	const apps = new Map<string, HostableMcpApp>();
	for (const contribution of contributions) {
		for (const tool of contribution.metadata.tools) {
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

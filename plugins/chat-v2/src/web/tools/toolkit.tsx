import type { ToolCallMessagePartComponent, Toolkit } from "@assistant-ui/react";
import { memo, type ComponentType, type FC } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { toolWireName } from "@kilo-desktop/plugin-core/contracts";

import { ToolRenderer, type ToolCategory, type ToolRendererImplementation } from "../../contracts";
import { toToolCallProps, type ToolCallProps } from "./tool-call";
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
	for (const [tool, chain] of byTool) {
		toolkit[tool] = {
			type: "backend",
			render: partRenderer(rendererChain(chain)),
			...(chain[0]!.metadata.standalone ? { display: "standalone" as const } : {}),
		};
	}
	return { toolkit, categories };
}

/**
 * The window's tool renderers as the thread's toolkit. Contributed categories
 * are window-wide (pure grouping helpers read them), so they are published
 * here too.
 */
export function useContributedToolkit(): Toolkit {
	const { toolkit, categories } = buildToolkit(useExtensions(ToolRenderer));
	setContributedToolCategories(categories);
	return toolkit;
}

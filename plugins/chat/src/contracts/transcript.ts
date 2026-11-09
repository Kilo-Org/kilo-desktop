import type { ToolCallMessagePartComponent, ToolCallMessagePartProps } from "@assistant-ui/react";
import type { ComponentType } from "react";
import type { Components, Options } from "react-markdown";
import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

import type { ComposerFolder } from "./composer";

// --- tool-renderer ---

/**
 * The activity group a tool's calls join in the transcript ("Edited 2
 * files", "Ran 3 commands"). Tools without one group by their MCP server, or
 * as generic tools.
 */
export const toolCategorySchema = z.enum([
	"editing",
	"writing",
	"reading",
	"searching",
	"web",
	"terminal",
	"planning",
	"asking",
	"skill",
	"subagent",
]);
export type ToolCategory = z.output<typeof toolCategorySchema>;

/** A tool call as assistant-ui hands it to a renderer: args, result, status, … */
export type ToolCallProps = ToolCallMessagePartProps;

export interface ToolRendererProps extends ToolCallProps {
	/**
	 * What the call would look like without this contribution: the next
	 * renderer contributed for the tool, else the transcript's one-line
	 * fallback. Render it to wrap or decorate the default.
	 */
	readonly Original: ToolCallMessagePartComponent;
}

export interface ToolRendererImplementation {
	readonly component: ComponentType<ToolRendererProps>;
}

/**
 * How calls to some tools look in the chat transcript. `tools` are the names
 * Kilo calls them by (`bash`, `desktop_terminal_open`); the highest-priority
 * contribution for a tool renders it and is handed the next one as
 * `Original`. `standalone` keeps the calls out of the activity groups and the
 * settled turn's fold (cards that stay actionable); `category` puts them in a
 * built-in group. kilo.chat's own renderers come through it too.
 */
export const ToolRenderer = defineExtensionPoint({
	id: "kilo.chat/tool-renderer",
	kind: "additive",
	description: "How calls to a tool look in the chat transcript.",
	metadata: z.object({
		tools: z.array(z.string().min(1)).min(1),
		standalone: z.boolean().default(false),
		category: toolCategorySchema.optional(),
	}),
	implementation: implementation<ToolRendererImplementation>("renderer"),
});

// --- mcp-app ---

export interface McpAppImplementation {
	/**
	 * The widget's HTML, when the contributing plugin ships it. Without it the
	 * resource is read from the tool's MCP server through Kilo.
	 */
	readonly loadHtml?: () => Promise<string> | string;
}

/**
 * An MCP App widget (an interactive `ui://` resource) shown in place of a
 * tool's calls. Chat hosts only widgets contributed here, in an isolated
 * frame; a widget's own tool calls are scoped to `serverId` (`desktop`: the
 * app's agent tools).
 */
export const McpApp = defineExtensionPoint({
	id: "kilo.chat/mcp-app",
	kind: "additive",
	description: "An interactive MCP App widget shown for a tool's calls.",
	metadata: z.object({
		tools: z.array(z.string().min(1)).min(1),
		resourceUri: z.string().startsWith("ui://"),
		serverId: z.string().min(1).default("desktop"),
	}),
	implementation: implementation<McpAppImplementation>("renderer", { required: false }),
});

// --- markdown-extension ---

/** Where a transcript's markdown is shown: links and paths resolve against it. */
export interface ChatMarkdownContext {
	/** The Work Session the transcript belongs to; panes opened from markdown join it. */
	readonly sessionId: string;
	readonly workspaceFolders: readonly ComposerFolder[];
}

/**
 * Remark plugins and decorators over the rendered components (the shape of
 * `@kilo-desktop/ui`'s `MarkdownRendererExtension`).
 */
export interface ChatMarkdownExtension {
	readonly remarkPlugins?: NonNullable<Options["remarkPlugins"]>;
	readonly decorateComponents?: (next: Components) => Components;
}

/** Made once per transcript: remark plugins and component decorators for its markdown. */
export type MarkdownExtensionImplementation = (
	context: ChatMarkdownContext,
) => ChatMarkdownExtension;

/**
 * Extends how the agent's replies render as markdown: remark plugins and
 * decorators over the rendered components (file paths as links, URLs opened
 * in a pane).
 */
export const MarkdownExtension = defineExtensionPoint({
	id: "kilo.chat/markdown-extension",
	kind: "additive",
	description: "Remark plugins and component decorators for the transcript's markdown.",
	implementation: implementation<MarkdownExtensionImplementation>("renderer"),
});

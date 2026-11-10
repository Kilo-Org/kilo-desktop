import { z } from "zod";

import type { Contribution, KernelLogger } from "@kilo-desktop/kernel";

import { toolWireName, type Tool, type ToolImplementation } from "../../../contracts";

type ToolContribution = Contribution<typeof Tool>;
export type AgentToolMetadata = ToolContribution["metadata"];

export interface CatalogTool {
	/** The name the MCP server lists; Kilo prefixes its `desktop` server name, giving `wireName`. */
	readonly name: string;
	readonly wireName: string;
	/** The contributing plugin: a declined sign-in withdraws its sign-in tools together. */
	readonly pluginId: string;
	readonly description: string;
	readonly inputSchema: Readonly<Record<string, unknown>>;
	readonly metadata: AgentToolMetadata;
	readonly implementation: ToolImplementation;
}

/** Where the catalog reads tools from: `kilo.core/tool` contributions in main. */
export interface ToolSource {
	list(): readonly ToolContribution[];
	subscribe(listener: () => void): () => void;
}

const WIRE_PREFIX = "desktop_";

/** The MCP name of a contribution: its wire name without the prefix Kilo adds. */
export function mcpToolName(contributionKey: string): string {
	return toolWireName(contributionKey).slice(WIRE_PREFIX.length);
}

/**
 * The agent tools the gateway serves, built from `kilo.core/tool`
 * contributions whose implementations run in this process (decision 47).
 *
 * Ownership and invariants:
 * - The kernel's extension registry is the only source; nothing outside the
 *   app's plugins can add, rename or shadow a tool. A second contribution
 *   whose name sanitizes to an existing one is skipped with a warning.
 * - Rebuilt on every change to the point (which includes context-key
 *   changes). Subscribers are notified, and `version` bumped, only when what
 *   clients see (names, descriptions, schemas, metadata) changed, so they get
 *   one `tools/list_changed` per real change.
 * - Implementations are taken from the latest rebuild, so a call always runs
 *   the currently bound code.
 * - A tool whose input schema can't be expressed as a JSON object schema is
 *   left out with a warning rather than served with a wrong schema.
 */
export class ToolCatalog {
	readonly #source: ToolSource;
	readonly #logger: Pick<KernelLogger, "warn"> | undefined;
	readonly #listeners = new Set<() => void>();
	readonly #unsubscribe: () => void;
	readonly #schemas = new WeakMap<z.ZodType, Readonly<Record<string, unknown>> | null>();
	readonly #warned = new Set<string>();
	#tools: readonly CatalogTool[] = [];
	#byName = new Map<string, CatalogTool>();
	#signature = "[]";
	#version = 0;

	constructor(source: ToolSource, logger?: Pick<KernelLogger, "warn">) {
		this.#source = source;
		this.#logger = logger;
		this.#rebuild();
		this.#unsubscribe = source.subscribe(() => this.#rebuild());
	}

	get version(): number {
		return this.#version;
	}

	get tools(): readonly CatalogTool[] {
		return this.#tools;
	}

	find(name: string): CatalogTool | undefined {
		return this.#byName.get(name);
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	dispose(): void {
		this.#unsubscribe();
		this.#listeners.clear();
	}

	#rebuild(): void {
		const tools: CatalogTool[] = [];
		const byName = new Map<string, CatalogTool>();
		for (const contribution of this.#source.list()) {
			const implementation = contribution.implementation;
			if (!implementation) continue;
			const name = mcpToolName(contribution.key);
			if (byName.has(name)) {
				this.#warnOnce(`Skipped tool "${contribution.key}": "${name}" is already taken.`);
				continue;
			}
			const inputSchema = this.#inputSchema(contribution.key, implementation.input);
			if (!inputSchema) continue;
			const tool: CatalogTool = {
				name,
				wireName: toolWireName(contribution.key),
				pluginId: contribution.pluginId,
				description: implementation.description,
				inputSchema,
				metadata: contribution.metadata,
				implementation,
			};
			byName.set(name, tool);
			tools.push(tool);
		}
		this.#tools = tools;
		this.#byName = byName;
		const signature = JSON.stringify(
			tools.map(({ name, description, inputSchema, metadata }) => [
				name,
				description,
				inputSchema,
				metadata,
			]),
		);
		if (signature === this.#signature) return;
		this.#signature = signature;
		this.#version += 1;
		for (const listener of [...this.#listeners]) listener();
	}

	#inputSchema(key: string, schema: z.ZodType): Readonly<Record<string, unknown>> | null {
		const cached = this.#schemas.get(schema);
		if (cached !== undefined) return cached;
		let json: Record<string, unknown> | null = null;
		try {
			const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<
				string,
				unknown
			>;
			if (rest.type === "object") json = rest;
			else this.#warnOnce(`Skipped tool "${key}": its input must be an object.`);
		} catch (error) {
			this.#warnOnce(
				`Skipped tool "${key}": its input has no JSON schema (${error instanceof Error ? error.message : String(error)}).`,
			);
		}
		this.#schemas.set(schema, json);
		return json;
	}

	#warnOnce(message: string): void {
		if (this.#warned.has(message)) return;
		this.#warned.add(message);
		this.#logger?.warn(message);
	}
}

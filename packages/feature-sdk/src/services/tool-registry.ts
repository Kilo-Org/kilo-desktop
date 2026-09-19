import type { RegisteredTool, ToolDefinition, ToolInvocationContext } from "../types/sdk.js";

/**
 * In-memory tool registry backing `sdk.tools`.
 *
 * Shell infrastructure — features never construct this; they use
 * `sdk.tools.register`, which delegates here. An AI runtime (the WebMCP bridge)
 * consumes all()/invoke() and subscribes to change notifications to publish
 * tools to `document.modelContext`.
 *
 * Tool names are auto-namespaced "featureId.name". Duplicate registration warns
 * and replaces. Registration/removal notifies subscribers so consumers re-sync.
 */
export class ToolRegistry {
	private tools = new Map<string, { definition: ToolDefinition; featureId: string }>();
	private listeners = new Set<() => void>();

	/** Register a tool for a feature. Returns an unregister function. */
	register(featureId: string, definition: ToolDefinition): () => void {
		if (typeof definition?.name !== "string" || definition.name.length === 0) {
			throw new Error("[ToolRegistry] Tool definition requires a non-empty name.");
		}
		if (typeof definition.description !== "string" || definition.description.length === 0) {
			throw new Error(`[ToolRegistry] Tool "${definition.name}" requires a description.`);
		}
		if (typeof definition.handler !== "function") {
			throw new Error(`[ToolRegistry] Tool "${definition.name}" requires a handler function.`);
		}

		const id = `${featureId}.${definition.name}`;
		if (this.tools.has(id)) {
			console.warn(`[ToolRegistry] Tool "${id}" registered twice — replacing.`);
		}
		// Bind the returned closure to THIS entry object, not just the id string.
		// Two callers can legitimately register the same name (register-twice
		// warns-and-replaces), and destroying an SDK re-runs any raw closures
		// stashed in its disposable set. A stale unregister for a replaced or
		// already-torn-down entry must be a no-op — not silently evict whichever
		// entry now owns the id. Same identity-check pattern as the WebMCP
		// bridge's publish/unpublish race guard.
		const entry = { definition, featureId };
		this.tools.set(id, entry);
		this.notify();
		return () => {
			if (this.tools.get(id) === entry) {
				this.tools.delete(id);
				this.notify();
			}
		};
	}

	/** All registered tools (definition metadata only, no handler). */
	all(): RegisteredTool[] {
		return Array.from(this.tools.entries(), ([id, { definition, featureId }]) => ({
			featureId,
			id,
			name: definition.name,
			description: definition.description,
			exposeToModelContext: definition.exposeToModelContext === true,
			...(definition.inputSchema ? { inputSchema: definition.inputSchema } : {}),
			...(definition.annotations ? { annotations: definition.annotations } : {}),
		}));
	}

	/**
	 * Invoke a tool by feature id + name. Validates args through the tool's
	 * `validate` schema (when present) before calling the handler. Caller
	 * context is adapter-supplied metadata and is never taken from `args`.
	 */
	async invoke(
		featureId: string,
		toolName: string,
		args: unknown,
		context: ToolInvocationContext = {},
	): Promise<unknown> {
		const entry = this.tools.get(`${featureId}.${toolName}`);
		if (!entry) {
			throw new Error(`Tool not found: ${featureId}.${toolName}`);
		}
		const { definition } = entry;
		const parsed = definition.validate ? definition.validate.parse(args) : args;
		return definition.handler(parsed, context);
	}

	/** Remove every tool owned by a feature (feature/plugin teardown). */
	removeFeature(featureId: string): void {
		let changed = false;
		for (const [id, entry] of this.tools) {
			if (entry.featureId === featureId) {
				this.tools.delete(id);
				changed = true;
			}
		}
		if (changed) this.notify();
	}

	/** Subscribe to registration changes. Returns an unsubscribe function. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.warn("[ToolRegistry] change listener threw:", error);
			}
		}
	}
}

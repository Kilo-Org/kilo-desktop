import type { RegisteredTool } from "@anaconda-agentic-desktop/feature-sdk";
import type { FeatureSystem } from "@anaconda-agentic-desktop/sdk-react";
import type { CallToolResult, InputSchema, ToolAnnotations } from "@mcp-b/webmcp-types";
import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";

/** Loopback host the relay daemon binds to. The relay only accepts local connections. */
const RELAY_HOST = "127.0.0.1";
/**
 * Identity-pinned rendezvous — MUST stay in sync with the managed relay args in
 * `plugins/kilo-server/src/main/initialize-managed-config.ts` (`WEBMCP_RELAY_PORT`,
 * `WEBMCP_RELAY_ID`).
 *
 * The 9333–9348 loopback range is shared by every WebMCP relay on the machine
 * (Claude Desktop configs, npx relays, other apps). Without the id pin, the
 * widget pairs with the FIRST relay that answers its scan — often a foreign or
 * orphaned relay on 9333 — while kilo's own relay sits elsewhere with zero
 * producers ("tools disappeared" split-brain; see docs/webmcp.md §7). With the
 * pin, the widget rejects any relay whose server-hello carries a different
 * relay id, and the port hint makes the first probe hit our relay directly.
 */
const RELAY_PORT = "9345";
const RELAY_ID = "anaconda-agentic-desktop";
/** Path (relative to the app origin) of the self-hosted relay bootstrap script. */
const EMBED_SCRIPT_PATH = "webmcp/embed.js";
const EMPTY_INPUT_SCHEMA: InputSchema = { type: "object", properties: {} };

let installed = false;

/**
 * Installs the WebMCP runtime for the renderer and bridges the feature-SDK tool
 * registry to `document.modelContext`:
 *
 * 1. Initializes the official `@mcp-b/webmcp-polyfill` (testing shim on, so the
 *    self-hosted relay `embed.js` can discover/execute tools via
 *    `navigator.modelContextTesting`).
 * 2. Publishes every tool registered through `sdk.tools` to `document.modelContext`,
 *    and re-syncs whenever the registry changes (plugins registering/removing tools).
 * 3. Injects the self-hosted relay `embed.js`, bridging tools to a local
 *    `@mcp-b/webmcp-local-relay` daemon for external MCP clients (Kilo CLI, ...).
 *
 * Safe to call once per renderer; subsequent calls are no-ops.
 */
export function installWebMcp(system: FeatureSystem): void {
	if (installed || typeof document === "undefined") return;
	installed = true;

	// Non-destructive: skips if the browser ships native WebMCP or a polyfill already ran.
	initializeWebMCPPolyfill({ installTestingShim: true });

	const modelContext = document.modelContext;
	if (!modelContext) {
		console.warn("[webmcp] document.modelContext is unavailable; tools were not published.");
		return;
	}

	const registry = system.services.toolRegistry;
	// One published entry per model-context tool, keyed by the registry's namespaced
	// id. Aborting the controller unregisters the tool from document.modelContext.
	// `signature` captures the advertised descriptor so a re-registered tool whose
	// metadata changed is re-published rather than left stale.
	const published = new Map<string, { controller: AbortController; signature: string }>();
	// Tracks which registry id currently owns each sanitized MCP wire name, so
	// two tools that sanitize to the same name don't silently overwrite one
	// another on `document.modelContext`. First registration wins; the loser is
	// logged loudly so the plugin author can pick a distinct name.
	const mcpNameOwners = new Map<string, string>();

	const publish = (tool: RegisteredTool): void => {
		const mcpName = toMcpToolName(tool);
		const existingOwner = mcpNameOwners.get(mcpName);
		if (existingOwner && existingOwner !== tool.id) {
			console.warn(
				`[webmcp] Tool "${tool.id}" sanitizes to MCP name "${mcpName}", which is already ` +
					`owned by "${existingOwner}". Skipping to avoid overwriting the earlier tool. ` +
					`Use only [A-Za-z0-9_] in tool + feature ids to prevent collisions.`,
			);
			return;
		}
		mcpNameOwners.set(mcpName, tool.id);

		const controller = new AbortController();
		const entry = { controller, signature: descriptorSignature(tool) };
		published.set(tool.id, entry);
		void Promise.resolve(
			modelContext.registerTool(
				{
					name: mcpName,
					description: tool.description,
					inputSchema: (tool.inputSchema as InputSchema | undefined) ?? EMPTY_INPUT_SCHEMA,
					...(tool.annotations ? { annotations: tool.annotations as ToolAnnotations } : {}),
					execute: (args: Record<string, unknown>) => executeTool(system, tool, args),
				},
				{ signal: controller.signal },
			),
		).catch((error: unknown) => {
			// Delete only if THIS attempt still owns the entry. A concurrent
			// re-publish (metadata change, quick unregister/register) may have
			// swapped in a fresh entry we must not evict.
			if (published.get(tool.id) === entry) {
				published.delete(tool.id);
				if (mcpNameOwners.get(mcpName) === tool.id) mcpNameOwners.delete(mcpName);
			}
			console.warn(`[webmcp] Failed to publish tool "${tool.id}":`, error);
		});
	};

	const unpublish = (id: string, entry: { controller: AbortController }): void => {
		entry.controller.abort();
		published.delete(id);
		for (const [mcpName, owner] of mcpNameOwners) {
			if (owner === id) mcpNameOwners.delete(mcpName);
		}
	};

	const sync = (): void => {
		// Only tools that explicitly opted in are exposed to the unauthenticated relay.
		const tools = registry.all().filter((tool) => tool.exposeToModelContext);
		const live = new Map(tools.map((tool) => [tool.id, tool]));

		// Remove tools that are gone or no longer exposed.
		for (const [id, entry] of published) {
			if (!live.has(id)) unpublish(id, entry);
		}

		for (const tool of tools) {
			const existing = published.get(tool.id);
			if (!existing) {
				publish(tool);
			} else if (existing.signature !== descriptorSignature(tool)) {
				// Metadata changed on a re-register: re-publish so clients see the update.
				unpublish(tool.id, existing);
				publish(tool);
			}
		}
	};

	registry.subscribe(sync);
	sync();
	injectRelayEmbed();
	startRelayReconnectNudge();
}

/** Namespaced MCP tool name: `featureId_name`, sanitized to `[A-Za-z0-9_]`. */
function toMcpToolName(tool: RegisteredTool): string {
	return `${tool.featureId}_${tool.name}`.replace(/[^A-Za-z0-9_]/g, "_");
}

/** Stable signature of the advertised descriptor; changes trigger a re-publish. */
function descriptorSignature(tool: RegisteredTool): string {
	return JSON.stringify({
		name: toMcpToolName(tool),
		description: tool.description,
		inputSchema: tool.inputSchema ?? null,
		annotations: tool.annotations ?? null,
	});
}

/** Invoke the tool through the registry (which validates args) and wrap the result. */
async function executeTool(
	system: FeatureSystem,
	tool: RegisteredTool,
	args: Record<string, unknown>,
): Promise<CallToolResult> {
	try {
		const result = await system.services.toolRegistry.invoke(tool.featureId, tool.name, args);
		return { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }] };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { isError: true, content: [{ type: "text", text: message }] };
	}
}

/**
 * Injects the relay bootstrap script from the app's own origin. `embed.js` resolves
 * `widget.html` relative to its own `src`, so serving both from `/webmcp/` keeps the
 * entire relay flow same-origin under the app's CSP (no CDN, works offline).
 */
function injectRelayEmbed(): void {
	if (document.querySelector("script[data-webmcp-embed]")) return;

	const script = document.createElement("script");
	script.src = new URL(EMBED_SCRIPT_PATH, document.baseURI).href;
	script.async = true;
	script.dataset.webmcpEmbed = "1";
	script.setAttribute("data-relay-host", RELAY_HOST);
	script.setAttribute("data-relay-port", RELAY_PORT);
	script.setAttribute("data-relay-id", RELAY_ID);
	script.addEventListener("error", () => {
		console.warn("[webmcp] Failed to load relay embed script; external tool relay is disabled.");
	});
	document.head.append(script);
}

/** How often the widget is nudged to retry relay discovery while disconnected. */
const RELAY_RECONNECT_NUDGE_MS = 15_000;

/**
 * Single-shot wake-up for the relay widget. Exported for tests.
 *
 * The widget accepts `webmcp.connect` from the host page origin and treats it
 * as: connected or mid-discovery → no-op; dormant or idle-disconnected →
 * immediate re-discovery (the pinned 9345 endpoint is the first probe).
 */
export function nudgeRelayWidget(): void {
	const frame = document.querySelector<HTMLIFrameElement>("iframe[data-webmcp-relay]");
	frame?.contentWindow?.postMessage({ type: "webmcp.connect" }, window.location.origin);
}

/**
 * Periodically wakes the relay widget so it retries discovery.
 *
 * Closes the boot-order race between the renderer and the relay: `kilo serve`
 * boots its MCP servers lazily, so the relay can bind its port ~30-60s AFTER
 * the widget's finite discovery ladder (initial scan → 10s/20s/30s retries →
 * dormant with 120s re-probes) has gone quiet. Measured on a dev machine the
 * resulting "relay up, widget dormant" dead zone lasted minutes, during which
 * Kilo truthfully reports zero WebMCP tools.
 *
 * A 15s cadence bounds the dead zone regardless of how the relay's lifecycle
 * drifts (lazy boot, orphan-takeover blip, EPIPE restart).
 */
function startRelayReconnectNudge(): void {
	setInterval(nudgeRelayWidget, RELAY_RECONNECT_NUDGE_MS);
}

import {
	TOOL_CATALOG_FEATURE_ID,
	TOOL_CATALOG_PORT_CHANNEL,
	TOOL_CATALOG_PROTOCOL_VERSION,
	agentToolName,
	toolCatalogConsumerMessageSchema,
	type RegisteredTool,
	type ToolCatalogConsumerMessage,
	type ToolCatalogProducerMessage,
	type ToolDescriptor,
	type ToolInvocationContext,
} from "@kilo-desktop/feature-sdk";
import type { FeatureSystem } from "@kilo-desktop/sdk-react";

/**
 * Publishes the renderer's agent tools to the main process, which serves them
 * to MCP consumers, and runs the calls main routes back.
 *
 * Every registry change schedules one full snapshot; notifications within the
 * same tick (a plugin registering several tools at boot) coalesce into one.
 * The port is the only channel: main accepts it solely from trusted app
 * frames, so no other process can add or shadow these tools. Cancellations
 * cannot stop a running handler (handlers take no signal); they only make
 * this side drop the late result.
 */

const EMPTY_INPUT_SCHEMA = { type: "object", properties: {} } as const;
const DEFAULT_RETRY_DELAYS_MS = [250, 1_000, 5_000];

type PortOpener = (featureId: string, channel: string, args?: unknown) => unknown;
type CallMessage = Extract<ToolCatalogConsumerMessage, { type: "call" }>;

export interface ToolCatalogPublisherOptions {
	/** Delays between reconnect attempts; the last one repeats. */
	readonly retryDelaysMs?: readonly number[];
}

/** Starts publishing; returns a function that stops it and closes the port. */
export function startToolCatalogPublisher(
	system: FeatureSystem,
	options: ToolCatalogPublisherOptions = {},
): () => void {
	const openPort = system.services.openPort as PortOpener | undefined;
	if (!openPort) return () => undefined;

	const registry = system.services.toolRegistry;
	const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
	let port: MessagePort | undefined;
	let routes = new Map<string, RegisteredTool>();
	let revision = 0;
	let publishScheduled = false;
	let attempts = 0;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	/** Calls still running; a cancel only applies to these. */
	const inFlight = new Set<string>();
	const cancelled = new Set<string>();

	const post = (message: ToolCatalogProducerMessage): void => {
		port?.postMessage(message);
	};

	const publish = (): void => {
		publishScheduled = false;
		if (!port) return;
		const snapshot = buildSnapshot(registry.all());
		routes = snapshot.routes;
		revision += 1;
		post({ type: "catalog", revision, tools: snapshot.tools });
	};

	const schedulePublish = (): void => {
		if (publishScheduled || !port) return;
		publishScheduled = true;
		setTimeout(publish, 0);
	};

	const runCall = async (call: CallMessage): Promise<void> => {
		inFlight.add(call.id);
		const tool = routes.get(call.name);
		let message: ToolCatalogProducerMessage;
		try {
			if (!tool) throw new Error(`Unknown tool "${call.name}".`);
			const result = await registry.invoke(
				tool.featureId,
				tool.name,
				call.args,
				toInvocationContext(call.context),
			);
			message = { type: "result", id: call.id, ok: true, result: toJsonValue(result) };
		} catch (error) {
			message = {
				type: "result",
				id: call.id,
				ok: false,
				error: { message: error instanceof Error ? error.message : String(error) },
			};
		}
		inFlight.delete(call.id);
		if (cancelled.delete(call.id)) return;
		post(message);
	};

	const handleMessage = (event: MessageEvent<unknown>): void => {
		const parsed = toolCatalogConsumerMessageSchema.safeParse(event.data);
		if (!parsed.success) return;
		if (parsed.data.type === "call") void runCall(parsed.data);
		else if (inFlight.has(parsed.data.id)) cancelled.add(parsed.data.id);
	};

	const scheduleReconnect = (): void => {
		if (stopped || retryTimer !== undefined) return;
		const delay = retryDelaysMs[Math.min(attempts, retryDelaysMs.length - 1)] ?? 1_000;
		attempts += 1;
		retryTimer = setTimeout(() => {
			retryTimer = undefined;
			connect();
		}, delay);
	};

	const connect = (): void => {
		if (stopped) return;
		try {
			const opened = openPort(TOOL_CATALOG_FEATURE_ID, TOOL_CATALOG_PORT_CHANNEL, {
				version: TOOL_CATALOG_PROTOCOL_VERSION,
			}) as MessagePort;
			opened.onmessage = handleMessage;
			opened.addEventListener("close", () => {
				if (port !== opened) return;
				port = undefined;
				scheduleReconnect();
			});
			opened.start();
			port = opened;
			attempts = 0;
			publish();
		} catch (error) {
			console.warn("[tool-catalog] Could not open the tool catalog port:", error);
			scheduleReconnect();
		}
	};

	const unsubscribe = registry.subscribe(schedulePublish);
	connect();

	return () => {
		stopped = true;
		unsubscribe();
		if (retryTimer !== undefined) clearTimeout(retryTimer);
		port?.close();
		port = undefined;
	};
}

function buildSnapshot(all: readonly RegisteredTool[]): {
	tools: ToolDescriptor[];
	routes: Map<string, RegisteredTool>;
} {
	const tools: ToolDescriptor[] = [];
	const routes = new Map<string, RegisteredTool>();
	for (const tool of all) {
		if (!tool.exposeToModelContext) continue;
		const name = agentToolName(tool);
		if (routes.has(name)) {
			console.warn(
				`[tool-catalog] Tool "${tool.id}" sanitizes to "${name}", which "${routes.get(name)!.id}" ` +
					"already uses. Skipping it; use only [A-Za-z0-9_] in tool and feature ids.",
			);
			continue;
		}
		routes.set(name, tool);
		tools.push({
			name,
			description: tool.description,
			inputSchema: (tool.inputSchema as ToolDescriptor["inputSchema"] | undefined) ?? {
				...EMPTY_INPUT_SCHEMA,
			},
			...(tool.annotations ? { annotations: tool.annotations } : {}),
			...(tool.requiresSignIn ? { requiresSignIn: true, signInScope: tool.featureId } : {}),
		});
	}
	return { tools, routes };
}

function toInvocationContext(context: CallMessage["context"]): ToolInvocationContext {
	return {
		...(context.kiloSessionId ? { kiloSessionId: context.kiloSessionId } : {}),
		...(context.kiloCallId ? { kiloCallId: context.kiloCallId } : {}),
	};
}

/** Tool results cross the port as plain JSON, as MCP clients receive them. */
function toJsonValue(value: unknown): unknown {
	if (value === undefined) return null;
	return JSON.parse(JSON.stringify(value)) as unknown;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resource, useResource } from "@assistant-ui/tap";
import type {
	McpAppResource,
	McpAppsHost,
	McpAppHostContext,
	McpAppHostInfo,
} from "@assistant-ui/react";
import type { ToolCallMessagePartProps } from "@assistant-ui/core/react";

import { type KiloMcpAppsHost } from "../../runtime/mcp-apps-host.js";

interface ElectronMcpAppRendererOptions {
	host: ReturnType<typeof KiloMcpAppsHost>;
	maxHeight?: number | undefined;
	hostInfo?: McpAppHostInfo | undefined;
	hostContext?: McpAppHostContext | undefined;
}

interface JsonRpcMessage {
	jsonrpc: "2.0";
	id?: string | number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

function isJsonRpcMessage(data: unknown): data is JsonRpcMessage {
	if (!data || typeof data !== "object") return false;
	return (data as Record<string, unknown>).jsonrpc === "2.0";
}

function sendToolResult(post: (msg: JsonRpcMessage) => void, output: unknown) {
	const text = typeof output === "string" ? output : JSON.stringify(output);
	post({ jsonrpc: "2.0", method: "notifications/tools/call/result", params: { result: output } });
	post({
		jsonrpc: "2.0",
		method: "ui/notifications/tool-result",
		params: { content: [{ type: "text", text }] },
	});
}

function ElectronMcpAppFrame({
	html,
	input,
	output,
	serverId,
	// Generous default: content-sized widgets stay fully visible (dynamic
	// height), while absurd values from a buggy widget are still rejected.
	maxHeight = 4000,
	hostInfo = { name: "Anaconda Desktop", version: "1.0.0" },
	hostContext = { displayMode: "inline", availableDisplayModes: ["inline"] },
	host,
}: {
	html: string;
	input: unknown;
	output: unknown;
	/** Server that owns this app — widget calls are scoped to it. */
	serverId?: string | undefined;
	/**
	 * Hard sanity ceiling for widget-reported heights. Widgets grow to fit
	 * their content (dynamic height); this only guards the host layout against
	 * a buggy/malicious widget reporting absurd values.
	 */
	maxHeight?: number | undefined;
	hostInfo?: McpAppHostInfo | undefined;
	hostContext?: McpAppHostContext | undefined;
	host: McpAppsHost;
}) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(400);
	const [blobUrl, setBlobUrl] = useState<string | null>(null);
	// Create and revoke the blob URL in one effect so StrictMode/concurrent
	// double-invocation cannot leak URLs (useMemo has no paired cleanup).
	useEffect(() => {
		const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
		setBlobUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [html]);
	const widgetReady = useRef(false);
	const pendingOutput = useRef<unknown>(undefined);

	const post = (msg: JsonRpcMessage) => {
		iframeRef.current?.contentWindow?.postMessage(msg, "*");
	};

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (!isJsonRpcMessage(event.data)) return;
			const msg = event.data;
			if (msg.id !== undefined && msg.method) {
				void handleRequest(msg as JsonRpcMessage & { id: string | number; method: string });
			} else if (msg.method && msg.id === undefined) {
				handleNotification(msg);
			}
		};

		const handleRequest = async (req: JsonRpcMessage & { id: string | number }) => {
			const respond = (result: unknown) => {
				post({ jsonrpc: "2.0", id: req.id, result } as JsonRpcMessage);
			};
			const respondError = (code: number, message: string) => {
				post({ jsonrpc: "2.0", id: req.id, error: { code, message } } as JsonRpcMessage);
			};
			try {
				switch (req.method) {
					case "ui/initialize": {
						respond({
							protocolVersion: "0.1",
							host: hostInfo,
							hostInfo,
							hostContext,
							capabilities: { tools: {}, resources: {}, ui: { sendMessage: true, openLink: true } },
							hostCapabilities: {
								openLinks: {},
								serverTools: {},
								serverResources: {},
								message: { text: {} },
							},
						});
						widgetReady.current = true;
						if (input !== undefined) {
							post({ jsonrpc: "2.0", method: "notifications/tools/call/input", params: { input } });
						}
						if (pendingOutput.current !== undefined) {
							sendToolResult(post, pendingOutput.current);
							pendingOutput.current = undefined;
						} else if (output !== undefined) {
							sendToolResult(post, output);
						}
						return;
					}
					case "tools/call": {
						const params = req.params as
							| { name: string; arguments?: Record<string, unknown> }
							| undefined;
						if (!params?.name) {
							respondError(-32602, "tools/call requires a string 'name'");
							return;
						}
						// Scope widget-initiated calls to the server that owns this app —
						// a widget must not drive tools on unrelated MCP servers.
						const result = await host.callTool({
							name: params.name,
							...(params.arguments ? { arguments: params.arguments } : {}),
							...(serverId ? { serverId } : {}),
						});
						respond(result);
						return;
					}
					case "resources/read": {
						const params = req.params as { uri: string } | undefined;
						if (!params?.uri) {
							respondError(-32602, "resources/read requires a string 'uri'");
							return;
						}
						// Same scoping rule as tools/call.
						const result = await host.readResource({
							uri: params.uri,
							...(serverId ? { serverId } : {}),
						});
						respond(result);
						return;
					}
					default:
						respondError(-32601, `Unknown method: ${req.method}`);
				}
			} catch (err) {
				respondError(-32603, err instanceof Error ? err.message : String(err));
			}
		};

		const handleNotification = (note: JsonRpcMessage) => {
			switch (note.method) {
				case "notifications/initialized":
					break;
				case "notifications/size_changed":
				case "ui/notifications/size-changed": {
					const params = note.params as { height?: unknown } | undefined;
					// Widget-reported value is untrusted — validate and clamp so a buggy
					// widget cannot blow up (or invert) the host layout.
					if (typeof params?.height === "number" && Number.isFinite(params.height)) {
						setHeight(Math.min(Math.max(Math.round(params.height), 40), maxHeight));
					}
					break;
				}
			}
		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [host, hostContext, hostInfo, input, maxHeight, output, serverId]);

	useEffect(() => {
		if (output === undefined) return;
		if (!widgetReady.current) {
			pendingOutput.current = output;
			return;
		}
		sendToolResult(post, output);
	}, [output]);

	// Blob URL is created in an effect, so the first commit renders nothing.
	if (!blobUrl) return null;

	return (
		<iframe
			ref={iframeRef}
			src={blobUrl}
			sandbox="allow-scripts"
			style={{
				border: "none",
				width: "100%",
				height: `${height}px`,
				borderRadius: "var(--radius, 0.625rem)",
				overflow: "hidden",
			}}
			title="MCP App"
		/>
	);
}

function getMcpAppFromPart(part: ToolCallMessagePartProps) {
	const app = (part as unknown as { mcp?: { app?: { resourceUri?: string; serverId?: string } } })
		.mcp?.app;
	if (!app?.resourceUri?.startsWith("ui://")) return undefined;
	return app;
}

function InlineRenderer({
	part,
	host,
	options,
}: {
	part: ToolCallMessagePartProps;
	host: McpAppsHost;
	options: ElectronMcpAppRendererOptions;
}) {
	const app = getMcpAppFromPart(part);
	const [loadedHtml, setLoadedHtml] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const resourceUri = app?.resourceUri;
	const serverId = app?.serverId;

	useEffect(() => {
		if (!resourceUri) return;
		let cancelled = false;
		host
			.loadResource({ uri: resourceUri, ...(serverId ? { serverId } : {}) })
			.then((res: McpAppResource) => {
				if (!cancelled) setLoadedHtml(res.html);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [host, resourceUri, serverId]);

	if (!app) return null;
	if (error)
		return (
			<div style={{ color: "var(--destructive, red)", padding: "8px" }}>MCP App error: {error}</div>
		);
	if (!loadedHtml)
		return <div style={{ color: "var(--muted-foreground)", padding: "8px" }}>Loading MCP App…</div>;

	return (
		<ElectronMcpAppFrame
			html={loadedHtml}
			input={part.args}
			output={part.result}
			serverId={serverId}
			maxHeight={options.maxHeight}
			hostInfo={options.hostInfo}
			hostContext={options.hostContext}
			host={host}
		/>
	);
}

function useElectronMcpAppRenderer(options: ElectronMcpAppRendererOptions) {
	const host = useResource(options.host);
	const render = useMemo(() => {
		const Render = (props: ToolCallMessagePartProps) => (
			<InlineRenderer part={props} host={host} options={options} />
		);
		Render.displayName = "ElectronMcpAppRenderer";
		return Render;
	}, [host, options]);
	return { render };
}

export const ElectronMcpAppRenderer = resource(useElectronMcpAppRenderer);

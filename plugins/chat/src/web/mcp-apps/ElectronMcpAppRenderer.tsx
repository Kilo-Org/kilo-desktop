import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { resource } from "@assistant-ui/tap";
import type {
	McpAppResource,
	McpAppsHost,
	McpAppHostContext,
	McpAppHostInfo,
	ToolCallMessagePartProps,
} from "@assistant-ui/react";

import {
	MCP_APP_HOST,
	MCP_APP_SHELL_HTML_MESSAGE,
	MCP_APP_SHELL_READY_MESSAGE,
	MCP_APP_WIDGET_DOCUMENT_PATH,
} from "../../contracts";
import { ToolCallFallback } from "../tools/tool-ui-inline";
import { isHostableMcpAppTool } from "./mcp-app-registry";
import { useMcpAppsHost } from "./mcp-apps-host";

/**
 * URL of the isolated widget shell on the dedicated `mcp-app` origin. The
 * renderer's own origin carries the right scheme (`kilo-desktop` or
 * `kilo-desktop-dev`); only the host differs. Off the custom scheme (e.g. the
 * web dev server) there is no such origin, so callers fall back to a blob:
 * iframe — a context with no preload bridge anyway.
 */
function mcpAppShellSrc(location: Pick<Location, "protocol">): string | undefined {
	if (!location.protocol.startsWith("kilo-desktop")) return undefined;
	return `${location.protocol}//${MCP_APP_HOST}${MCP_APP_WIDGET_DOCUMENT_PATH}`;
}

function isShellReadyMessage(data: unknown): boolean {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as { type?: unknown }).type === MCP_APP_SHELL_READY_MESSAGE
	);
}

/**
 * How long to wait for the isolated shell to announce readiness before showing
 * an error instead of a blank frame. The shell re-announces READY for ~5s (see
 * `mcp-app-host.ts`), so this only trips when the shell document never loads at
 * all (protocol error, 404) — hence generous, to avoid false positives on a
 * slow first load.
 */
const MCP_APP_SHELL_READY_TIMEOUT_MS = 10_000;

const HOST_INFO: McpAppHostInfo = { name: "Kilo Desktop", version: "1.0.0" };
const HOST_CONTEXT: McpAppHostContext = {
	displayMode: "inline",
	availableDisplayModes: ["inline"],
};

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

/** A tool call's output, and whether it is an error (the output is then its message). */
type ToolOutput = { readonly value: unknown; readonly isError: boolean };

function sendToolResult(post: (msg: JsonRpcMessage) => void, output: ToolOutput) {
	const text = typeof output.value === "string" ? output.value : JSON.stringify(output.value);
	post({
		jsonrpc: "2.0",
		method: "notifications/tools/call/result",
		params: { result: output.value },
	});
	post({
		jsonrpc: "2.0",
		method: "ui/notifications/tool-result",
		params: { content: [{ type: "text", text }], ...(output.isError ? { isError: true } : {}) },
	});
}

function ElectronMcpAppFrame({
	html,
	input,
	output,
	isError = false,
	serverId,
	// Generous default: content-sized widgets stay fully visible (dynamic
	// height), while absurd values from a buggy widget are still rejected.
	maxHeight = 4000,
	hostInfo = { name: "Kilo Desktop", version: "1.0.0" },
	hostContext = { displayMode: "inline", availableDisplayModes: ["inline"] },
	host,
}: {
	html: string;
	input: unknown;
	output: unknown;
	/** The output is an error message, not the tool's data. */
	isError?: boolean | undefined;
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
	// Preferred path: render the widget under the dedicated `mcp-app` origin so
	// its inline scripts execute there (isolated, opaque-origin, no preload)
	// rather than in a blob: iframe that would inherit the trusted app origin's
	// CSP and force `script-src 'unsafe-inline'` onto it (EoP 7). The blob
	// fallback only runs off the custom scheme (web dev server), where there is
	// no preload bridge to elevate to.
	const shellSrc = useMemo(() => mcpAppShellSrc(window.location), []);
	const [blobUrl, setBlobUrl] = useState<string | null>(null);
	// Create and revoke the blob URL in one effect so StrictMode/concurrent
	// double-invocation cannot leak URLs (useMemo has no paired cleanup).
	useEffect(() => {
		if (shellSrc) return;
		const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
		setBlobUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [html, shellSrc]);
	const widgetReady = useRef(false);
	const pendingOutput = useRef<ToolOutput | undefined>(undefined);
	// Whether the isolated shell has announced readiness for the current frame.
	// Distinct from `widgetReady` (the widget's own `ui/initialize`): the shell
	// handshake gates delivery of the HTML; `ui/initialize` gates delivery of the
	// tool output.
	const shellReady = useRef(false);
	const [shellError, setShellError] = useState(false);

	// Reload the frame whenever the widget HTML changes. On the shell path the
	// `src` is a fixed URL, and the isolated shell accepts HTML exactly once — it
	// removes its own message listener before the first `document.write` (see
	// `mcp-app-host.ts`), then that write replaces the document and the listener
	// with it. So new HTML for an already-mounted frame (e.g. `resourceUri`
	// changes and `InlineRenderer` re-fetches) can no longer reach the shell and
	// the widget would silently keep showing stale content. Bumping a generation
	// used as the iframe `key` remounts it, forcing a fresh shell that
	// re-announces readiness and receives the new HTML — mirroring the blob
	// path, where new HTML already yields a new blob: URL/src. Tracked by
	// generation, not the html string, so a large document is never held as a
	// React key. (Adjust-state-during-render is idempotent under StrictMode:
	// once `previousHtml` catches up, the branch stops firing.)
	const [previousHtml, setPreviousHtml] = useState(html);
	const [frameGeneration, setFrameGeneration] = useState(0);
	if (html !== previousHtml) {
		setPreviousHtml(html);
		setFrameGeneration((generation) => generation + 1);
	}
	// The reloaded shell re-runs its handshake and the widget re-runs
	// `ui/initialize`, so neither the shell's nor the widget's prior readiness
	// holds. Clear both (and any output staged for the old frame) so the output
	// is re-delivered to the fresh widget on init rather than posted into a frame
	// that is tearing down.
	useEffect(() => {
		shellReady.current = false;
		widgetReady.current = false;
		pendingOutput.current = undefined;
	}, [html]);

	// Surface an error instead of an indefinitely blank frame if the shell never
	// announces readiness (e.g. the shell document fails to load). Re-armed per
	// frame generation so a reload after a changed `html` gets a fresh window.
	// Shell path only — the blob fallback loads the widget directly, with no
	// handshake to wait on.
	useEffect(() => {
		if (!shellSrc) return;
		setShellError(false);
		const timer = setTimeout(() => {
			if (!shellReady.current) setShellError(true);
		}, MCP_APP_SHELL_READY_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [shellSrc, frameGeneration]);

	const post = (msg: JsonRpcMessage) => {
		iframeRef.current?.contentWindow?.postMessage(msg, "*");
	};

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) return;
			// The isolated shell (mcp-app origin) announces readiness; hand it the
			// widget HTML to write into its own document. The shell re-announces
			// until it gets the HTML, so this may fire more than once — posting
			// again is harmless (the shell drops its listener after the first
			// write). No-op in the blob path, where the widget is loaded directly.
			if (isShellReadyMessage(event.data)) {
				shellReady.current = true;
				iframeRef.current?.contentWindow?.postMessage(
					{ type: MCP_APP_SHELL_HTML_MESSAGE, html },
					"*",
				);
				return;
			}
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
							sendToolResult(post, { value: output, isError });
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
	}, [host, hostContext, hostInfo, input, maxHeight, output, isError, serverId, html]);

	useEffect(() => {
		if (output === undefined) return;
		const toolOutput = { value: output, isError };
		if (!widgetReady.current) {
			pendingOutput.current = toolOutput;
			return;
		}
		sendToolResult(post, toolOutput);
	}, [output, isError]);

	if (shellError)
		return (
			<div style={{ color: "var(--muted-foreground)", padding: "8px" }}>
				MCP App failed to load.
			</div>
		);

	// Prefer the isolated shell origin; the blob URL is created in an effect, so
	// on the fallback path the first commit renders nothing.
	const frameSrc = shellSrc ?? blobUrl;
	if (!frameSrc) return null;

	return (
		<iframe
			// Changing `key` on new HTML remounts the iframe, forcing the isolated
			// shell to reload and re-accept it (see the generation comment above).
			key={frameGeneration}
			ref={iframeRef}
			src={frameSrc}
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

function InlineRenderer({ part, host }: { part: ToolCallMessagePartProps; host: McpAppsHost }) {
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
			<Alert variant="destructive">
				<CircleAlertIcon aria-hidden="true" />
				<AlertTitle>Could not load the MCP app</AlertTitle>
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		);
	if (!loadedHtml)
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Spinner aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>Loading MCP app…</EmptyTitle>
				</EmptyHeader>
			</Empty>
		);

	return (
		<ElectronMcpAppFrame
			html={loadedHtml}
			input={part.args}
			output={part.result}
			isError={part.isError === true}
			serverId={serverId}
			hostInfo={HOST_INFO}
			hostContext={HOST_CONTEXT}
			host={host}
		/>
	);
}

/**
 * A call to a tool with a contributed MCP App, as its widget (framed in the
 * isolated `mcp-app` host), over the pane's {@link useMcpAppsHost}. Other
 * calls carrying `mcp.app` render as the one-line fallback.
 */
export function McpAppToolCall(props: ToolCallMessagePartProps) {
	const host = useMcpAppsHost();
	if (!host || !isHostableMcpAppTool(props.toolName)) return <ToolCallFallback {...props} />;
	return <InlineRenderer part={props} host={host} />;
}

/** assistant-ui's MCP App slot in `Tools`: renders tool calls whose part carries `mcp.app`. */
export const ElectronMcpAppRenderer = resource(() => ({ render: McpAppToolCall }));

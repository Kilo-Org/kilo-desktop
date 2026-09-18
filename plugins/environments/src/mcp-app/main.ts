import "./theme.css";
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { renderEnvList, renderError } from "./env-list";

function isTextContent(value: unknown): value is { type: "text"; text: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "text" &&
		"text" in value &&
		typeof value.text === "string"
	);
}

function textFromToolResult(content: unknown): string | undefined {
	if (Array.isArray(content)) {
		return content.find(isTextContent)?.text;
	}
	if (typeof content === "string") {
		return content;
	}
	return undefined;
}

const app = new App({ name: "conda-envs-list", version: "1.0.0" }, {});

app.ontoolresult = (result) => {
	// A genuine tool failure (conda missing, permission denied, ...) must not
	// masquerade as an empty environment list.
	if (result.isError) {
		renderError(textFromToolResult(result.content) || "The environments tool reported an error.");
		return;
	}
	try {
		const raw = textFromToolResult(result.content);
		const parsed = raw ? JSON.parse(raw) : [];
		const envs: Array<{ name: string; prefix: string }> = Array.isArray(parsed)
			? parsed
			: (parsed.envs ?? parsed.environments ?? []);
		renderEnvList(envs);
	} catch {
		renderError("Could not parse the environments tool output.");
	}
};

app.onhostcontextchanged = (ctx) => {
	if (ctx.theme) applyDocumentTheme(ctx.theme);
};

app.setupSizeChangedNotifications();

try {
	await app.connect();
	// Apply the initial theme delivered in the ui/initialize response. Without
	// this the widget renders in the default (light) palette until the host
	// later emits a host_context/changed notification.
	const initialTheme = app.getHostContext()?.theme;
	if (initialTheme) applyDocumentTheme(initialTheme);
} catch {
	// Bridge handshake failed (no MCP Apps host, or the host never replied).
	// Surface it instead of leaving a permanently blank widget.
	renderError("Could not connect to the chat host.");
}

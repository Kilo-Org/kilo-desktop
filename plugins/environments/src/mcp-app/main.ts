import "./theme.css";
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { renderEnvList, renderError } from "./env-list";

const app = new App({ name: "conda-envs-list", version: "1.0.0" }, {});

app.ontoolresult = (result) => {
	// A genuine tool failure (conda missing, permission denied, ...) must not
	// masquerade as an empty environment list.
	if (result.isError) {
		const text = Array.isArray(result.content)
			? result.content.find(
					(c): c is { type: "text"; text: string } => c.type === "text" && "text" in c,
				)?.text
			: undefined;
		renderError(text || "The environments tool reported an error.");
		return;
	}
	try {
		// MCP Apps protocol: content is Array<{ type: "text", text: string } | ...>
		// Extract the text content block containing the JSON array of environments.
		let raw: string | undefined;
		if (Array.isArray(result.content)) {
			const textBlock = result.content.find(
				(c): c is { type: "text"; text: string } => c.type === "text" && "text" in c,
			);
			raw = textBlock?.text;
		} else if (typeof result.content === "string") {
			// Fallback: assistant-ui may send the result as a plain string
			raw = result.content;
		}
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

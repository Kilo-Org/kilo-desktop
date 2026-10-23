/**
 * WebMCP `browser_open`: lets the Kilo agent show the user a web page — e.g. a
 * dev server it just started — in a Browser tab of the calling chat's pane
 * layout. The chat comes from trusted caller context, never visual focus.
 */
import type { SDK, ToolInvocationContext } from "@kilo-desktop/feature-sdk";
import { z } from "zod";

import { openBrowserTab } from "./open-browser-tab.js";

const KILO_UI_UNAVAILABLE =
	"The chat pane layout is unavailable. The chat UI plugin may not be loaded.";
const NO_CALLER_SESSION =
	"Opening a browser tab requires an originating Kilo chat session; visual focus is never used to pick the chat.";

const openBrowserInput = z.object({
	url: z
		.string()
		.min(1)
		.max(32_768)
		.describe("http(s) URL. A bare host such as localhost:3000 or example.com is accepted."),
});

/** Structural shape of kilo-ui's capability — asserted, not imported. */
interface SessionsCapabilities extends Record<string, unknown> {
	readonly sessions?: {
		sessionIdOfChat(kiloSessionId: string): string | undefined;
	};
}

/** The calling chat's work session, which owns the panes a tool opens. */
function callerSession(
	sdk: SDK,
	context: ToolInvocationContext,
): { sessionId: string } | { error: string } {
	const kiloSessionId = context.kiloSessionId?.trim();
	if (!kiloSessionId) return { error: NO_CALLER_SESSION };
	const sessions = sdk.plugins.get<SessionsCapabilities>("kilo-ui")?.sessions;
	if (!sessions) return { error: KILO_UI_UNAVAILABLE };
	// A chat no session owns (e.g. a subagent's) has no panes to open into.
	const sessionId = sessions.sessionIdOfChat(kiloSessionId);
	return sessionId ? { sessionId } : { error: NO_CALLER_SESSION };
}

function openBrowser(
	sdk: SDK,
	args: z.infer<typeof openBrowserInput>,
	context: ToolInvocationContext,
) {
	const caller = callerSession(sdk, context);
	if ("error" in caller) return caller;
	const { sessionId } = caller;
	const result = openBrowserTab(sdk, sessionId, args.url);
	return "error" in result ? result : { sessionId, ...result };
}

export function registerBrowserWebMcpTools(sdk: SDK): void {
	sdk.tools.register({
		name: "open",
		description:
			"Show the user a web page in a Browser tab of the calling chat's pane layout — for " +
			"example a local dev server you started, or documentation you are referring to. Only " +
			"http and https URLs are allowed. A tab already showing the URL is focused instead of " +
			"opening another. This displays the page to the user; it does not return its content.",
		inputSchema: z.toJSONSchema(openBrowserInput, { target: "draft-2020-12" }),
		validate: openBrowserInput,
		annotations: { idempotentHint: true, openWorldHint: true },
		exposeToModelContext: true,
		handler: (args, context) => openBrowser(sdk, openBrowserInput.parse(args), context),
	});
}

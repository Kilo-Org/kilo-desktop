/**
 * The Desktop agent tools spec's exchange with the chat-completions stub: for
 * `promptMarker` the stub calls kilo.chat's `html_render` (Kilo's
 * `desktop_chat_html_render`, a direct tool because Desktop's `desktop` MCP
 * server opts out of Kilo's Code Mode), then replies once the tool's result
 * is in. The tool only says the page was shown when Kilo told kilo.core's
 * gateway which chat called it (the caller-context plugin).
 */
export const desktopToolsData = {
	promptMarker: "DESKTOP-TOOLS-7c41",
	prompt: "Show the probe page DESKTOP-TOOLS-7c41.",
	reply: "The probe page is above.",
	toolName: "desktop_chat_html_render",
	pageTitle: "Desktop tools probe",
	/** `html_render`'s answer to a call from a Kilo chat. */
	renderedResult: "The page is shown to the user above your reply.",
} as const;

export const desktopToolsStubReplies: Record<string, string> = {
	[desktopToolsData.promptMarker]: desktopToolsData.reply,
};

export const desktopToolsStubToolCalls = {
	[desktopToolsData.promptMarker]: {
		name: desktopToolsData.toolName,
		arguments: { title: desktopToolsData.pageTitle, html: "<p>probe</p>" },
	},
};

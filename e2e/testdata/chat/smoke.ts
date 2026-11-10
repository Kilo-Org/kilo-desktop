/**
 * The kilo.chat smoke spec's one exchange with the mock chat-completions stub
 * (`utils/chat-completions-stub.ts`): the stub keys both its reply and the
 * title it gives Kilo's title agent on `promptMarker`.
 */
export const chatSmokeData = {
	promptMarker: "CHAT-SMOKE-2b9d",
	// Over 200 characters: Kilo names a chat after its first message only when
	// that message is substantial (`MIN_CHARS` in the CLI's session/title.ts).
	prompt:
		"Say hello to the smoke test CHAT-SMOKE-2b9d. This first message is long on purpose, " +
		"so that Kilo has enough to go on to name the chat right away instead of waiting for a " +
		"second message before it asks for a title.",
	reply: "Hello from the chat completions stub.",
	title: "Chat smoke greeting",
} as const;

/** Canned stub replies keyed by `promptMarker`. */
export const chatSmokeStubReplies: Record<string, string> = {
	[chatSmokeData.promptMarker]: chatSmokeData.reply,
};

/** Canned chat titles keyed by `promptMarker`, for Kilo's title requests. */
export const chatSmokeStubTitles: Record<string, string> = {
	[chatSmokeData.promptMarker]: chatSmokeData.title,
};

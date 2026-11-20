/**
 * The welcome file mention spec's one workspace file and the exchange with
 * the mock chat-completions stub (`utils/chat-completions-stub.ts`). The
 * stub keys its reply on `promptMarker`; the mention itself must resolve to
 * `resolvedMention` in the prompt that reaches the model.
 */
export const chatFileMentionData = {
	fileName: "welcome-mention-notes.txt",
	content: "A file in the session's workspace, mentioned from the welcome screen.\n",
	promptMarker: "MENTION-PROMPT-91de",
	reply: "I can see the file you mentioned.",
	/** kilo.files resolves a single-folder workspace mention to this `@/path` text. */
	resolvedMention: "@/welcome-mention-notes.txt",
} as const;

/** Canned stub replies keyed by `promptMarker`. */
export const chatFileMentionStubReplies: Record<string, string> = {
	[chatFileMentionData.promptMarker]: chatFileMentionData.reply,
};

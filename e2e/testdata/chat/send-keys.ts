export const chatSendKeysData = {
	enterMarker: "SEND-KEYS-ENTER-7b21",
	enterPrompt: "SEND-KEYS-ENTER-7b21 send with enter",
	enterReply: "Enter sent this message.",
	newlineMarker: "SEND-KEYS-NEWLINE-3f90",
	newlineFirstLine: "SEND-KEYS-NEWLINE-3f90 first line",
	newlineSecondLine: "second line",
	newlineReply: "Both lines arrived in order.",
	blankDraft: "   ",
	blankDraftFollowUp: "still-here",
} as const;

export const chatSendKeysStubReplies: Record<string, string> = {
	[chatSendKeysData.enterMarker]: chatSendKeysData.enterReply,
	[chatSendKeysData.newlineMarker]: chatSendKeysData.newlineReply,
};

export const chatFirstSendFailuresData = {
	noModelPrompt: "FIRST-SEND-NO-MODEL-2de1 missing-model first message",
	serverFailureMarker: "FIRST-SEND-HTTP-ERROR-83ab",
	serverFailurePrompt: "FIRST-SEND-HTTP-ERROR-83ab rejected first message",
	serverFailureMessage: "E2E first-prompt refusal 83ab",
	serverFailureTitle: "Chat first-send failure",
} as const;

/** Canned completions errors keyed by a unique typed-message marker. */
export const chatFirstSendFailureStubErrors: Record<string, { status: number; message: string }> = {
	[chatFirstSendFailuresData.serverFailureMarker]: {
		status: 400,
		message: chatFirstSendFailuresData.serverFailureMessage,
	},
};

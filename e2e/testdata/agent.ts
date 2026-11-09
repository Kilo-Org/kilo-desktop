export const agentData = {
	serviceKey: "kilo.agent/server",
	serverDomain: "kilo.agent/server",
	/** Cold CLI starts on CI runners take tens of seconds (the fixture's sidecar budget). */
	serverReadyTimeoutMs: 120_000,
} as const;

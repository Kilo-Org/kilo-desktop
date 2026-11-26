export type KiloConnection = {
	baseUrl: string;
	username: string;
	password: string;
	globalDirectory: string;
};

export type ChatModeSession = {
	id: string;
	directory: string;
	agent?: string;
};

/** An agent as Kilo v2's `GET /api/agent` lists it. */
export type KiloAgent = {
	id: string;
	name: string;
	mode: "subagent" | "primary" | "all";
	hidden?: boolean;
};

export const chatModeSelectorData = {
	locators: {
		agentItemTestIdPrefix: "kilo-agent-selector-item-",
		triggerTestId: "kilo-agent-selector-trigger",
		triggerLabel: '[data-slot="composer-agent-label"]',
		menuTestId: "kilo-agent-selector-content",
		messageInputName: "Message input",
		sendButtonTestId: /^kilo-composer-send(-when-connected)?$/,
		busyCatalogTriggerIds: ["kilo-agent-selector-trigger", "kilo-model-selector-trigger"],
	},
	builtInModes: ["code", "plan", "ask", "debug"] as const,
	modeLabels: {
		code: "Code",
		plan: "Plan",
		ask: "Ask",
		debug: "Debug",
	},
	defaultMode: "code",
	selectedMode: "plan",
	lastSelectedMode: "debug",
	transmissionModes: ["ask", "debug", "code"] as const,
	polling: {
		sessionTimeoutMs: 30_000,
		sessionIntervalMs: 500,
		selectionConvergeTimeoutMs: 20_000,
	},
	prompts: {
		plan: "Mode selector plan prompt",
		perChat: "Mode selector per-chat prompt",
		lastMode: "Mode selector last-mode prompt",
		modePrefix: "Mode selector ",
		modeSuffix: " prompt",
	},
	agentAliases: {
		build: "code",
	},
} as const;

export function canonicalizeAgentName(name: string): string {
	return (
		chatModeSelectorData.agentAliases[name as keyof typeof chatModeSelectorData.agentAliases] ??
		name
	);
}

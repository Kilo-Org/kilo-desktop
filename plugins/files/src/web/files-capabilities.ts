export interface ChatRightPanelCapability {
	setTabTitle(sessionId: string, instanceId: string, title: string): void;
	setTabIconKey(sessionId: string, instanceId: string, iconKey: string): void;
	setTabDirty(sessionId: string, instanceId: string, dirty: boolean): void;
	registerTabLifecycle(
		sessionId: string,
		instanceId: string,
		lifecycle: {
			save?: () => Promise<{
				outcome: "saved" | "cancelled" | "failed";
				reason?: string;
			}>;
			discard?: () => Promise<void>;
		},
	): () => void;
}

export interface ChatRightPanelCapabilities extends Record<string, unknown> {
	readonly chatRightPanel: ChatRightPanelCapability;
}

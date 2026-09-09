export interface ChatRightPanelCapability {
	getActiveTabId(sessionId: string): string | null;
	listTabs?(sessionId: string): readonly {
		readonly instanceId: string;
		readonly definitionId: string;
		readonly metadata?: Readonly<Record<string, string>>;
	}[];
	activateTab?(sessionId: string, instanceId: string): void;
	openContributedTab(
		sessionId: string,
		definition: { readonly id: string; readonly title: string },
		options: {
			readonly instanceId: string;
			readonly title: string;
			readonly iconKey?: string;
			readonly metadata: Readonly<Record<string, string>>;
		},
	): unknown;
	updateTab(
		sessionId: string,
		instanceId: string,
		update: {
			readonly title?: string;
			readonly iconKey?: string;
			readonly metadata?: Readonly<Record<string, string>>;
			readonly dirty?: boolean;
		},
	): void;
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

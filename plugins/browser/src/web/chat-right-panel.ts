export interface ChatPaneTab {
	readonly instanceId: string;
	readonly definitionId: string;
	readonly metadata?: Readonly<Record<string, string>>;
}

export type ChatRightPanelCapabilities = {
	readonly chatRightPanel: {
		listTabs(sessionId: string): readonly ChatPaneTab[];
		activateTab(sessionId: string, instanceId: string): void;
		openContributedTab(
			sessionId: string,
			definition: { readonly id: string; readonly title: string },
			options?: { readonly title?: string; readonly metadata?: Readonly<Record<string, string>> },
		): { readonly instanceId: string };
		updateTab(
			sessionId: string,
			instanceId: string,
			update: { title?: string; iconKey?: string; metadata?: Readonly<Record<string, string>> },
		): void;
		registerTabLifecycle(
			sessionId: string,
			instanceId: string,
			lifecycle: { onClose?: () => Promise<void> },
		): () => void;
	};
};

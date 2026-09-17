export type ChatRightPanelCapabilities = {
	readonly chatRightPanel: {
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

export interface ChatRightPanelCapabilities extends Record<string, unknown> {
	chatRightPanel?: {
		listTabs?(sessionId: string): readonly {
			readonly instanceId: string;
			readonly ordinal: number | null;
		}[];
		updateTab?(
			sessionId: string,
			instanceId: string,
			update: {
				readonly title?: string;
				readonly metadata?: Readonly<Record<string, string>>;
			},
		): void;
		closeTab?(sessionId: string, instanceId: string): void;
		registerTabLifecycle?(
			sessionId: string,
			instanceId: string,
			lifecycle: { readonly onClose?: () => Promise<void> },
		): () => void;
	};
}

export interface ChatRightPanelCapabilities extends Record<string, unknown> {
	chatRightPanel?: {
		listTabs?(sessionId: string): readonly {
			readonly instanceId: string;
			readonly definitionId: string;
			readonly title: string;
			readonly ordinal: number | null;
			readonly metadata?: Readonly<Record<string, string>>;
		}[];
		updateTab?(
			sessionId: string,
			instanceId: string,
			update: {
				readonly title?: string;
				readonly metadata?: Readonly<Record<string, string>>;
			},
		): void;
		openContributedTab?(
			sessionId: string,
			definition: { readonly id: string; readonly title: string },
		): { readonly instanceId: string; readonly title: string };
		closeTab?(sessionId: string, instanceId: string): void;
		registerTabLifecycle?(
			sessionId: string,
			instanceId: string,
			lifecycle: { readonly onClose?: () => Promise<void> },
		): () => void;
	};
}

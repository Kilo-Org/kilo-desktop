/** Structural shapes of the kilo-ui capabilities git uses — asserted, not imported. */
export interface ChatPaneTab {
	readonly instanceId: string;
	readonly definitionId: string;
	readonly metadata?: Readonly<Record<string, string>>;
}

export interface KiloUiCapabilities extends Record<string, unknown> {
	readonly chatRightPanel: {
		listTabs(sessionId: string): readonly ChatPaneTab[];
		activateTab(sessionId: string, instanceId: string): void;
		openContributedTab(
			sessionId: string,
			definition: { readonly id: string; readonly title: string },
			options?: { readonly metadata?: Readonly<Record<string, string>> },
		): { readonly instanceId: string };
		updateTab(
			sessionId: string,
			instanceId: string,
			update: { readonly metadata?: Readonly<Record<string, string>> },
		): void;
	};
	readonly chatSessionWorkspace: {
		getFolders(sessionId: string): readonly { readonly path: string }[];
		resolvePath(
			sessionId: string,
			path: string,
		): { readonly workspaceDirectory: string; readonly relativePath: string } | null;
	};
}

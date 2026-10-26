export const chatComposerData = {
	workspaceSelector: {
		// Trigger icons carry no data-qa-id, only this non-test marker
		// (WorkspaceSelector.tsx) — folder icon leads, chevron trails.
		leadingIconSelector: '[data-icon="inline-start"]',
		trailingIconSelector: '[data-icon="inline-end"]',
		triggerLabel: "Select workspace",
		searchPlaceholder: "Search workspaces",
		noWorkspaceLabel: "No workspace",
		noWorkspacesYetMessage: "No workspaces yet.",
		newWorkspaceLabel: "New workspace",
		createCommandTestId: "workspace-create-command",
		// cmdk's default listbox label (CommandList in command.tsx), already
		// used by new-chat-draft.ts to scope the same dropdown.
		suggestionsListboxName: "Suggestions",
	},
} as const;

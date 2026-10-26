import type { Locator } from "@playwright/test";
import {
	clear,
	click,
	expectElementToBeDisabled,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectElementToHaveText,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { chatComposerData } from "../../../testdata/chat-composer.js";
import { openNewChatDraft } from "./new-chat-draft.js";

export class ChatComposerPage {
	private readonly draftFooter = () => getLocatorByTestId("kilo-composer-draft-footer");
	private readonly workspaceSelector = () =>
		getLocatorByRole("combobox", { name: "Select workspace" });
	private readonly workspaceSelectorLeadingIcon = () =>
		this.workspaceSelector().locator(chatComposerData.workspaceSelector.leadingIconSelector);
	private readonly workspaceSelectorTrailingIcon = () =>
		this.workspaceSelector().locator(chatComposerData.workspaceSelector.trailingIconSelector);
	private readonly workspaceListbox = () =>
		getLocatorByRole("listbox", {
			name: chatComposerData.workspaceSelector.suggestionsListboxName,
		});
	// cmdk labels the search input with the Command's own `label` prop
	// ("Search workspaces"), via aria-labelledby — not the listbox name.
	private readonly workspaceSearchInput = () =>
		getLocatorByRole("combobox", {
			name: chatComposerData.workspaceSelector.searchPlaceholder,
		});
	private readonly unscopedOption = () => getLocatorByTestId("workspace-unscoped-command");
	private readonly newWorkspaceOption = () =>
		getLocatorByTestId(chatComposerData.workspaceSelector.createCommandTestId);
	private readonly workspaceRow = (workspaceName: string) =>
		this.workspaceListbox().getByText(workspaceName, { exact: true });
	private readonly messageInput = () => getLocatorByRole("textbox", { name: "Message input" });
	// The send control swaps ids on connection state (kilo-composer-send vs
	// kilo-composer-send-when-connected), so match both.
	private readonly sendButton = () => getLocatorByTestId(/^kilo-composer-send(-when-connected)?$/);

	async openDraft(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/plugins/chat";
		});
		await openNewChatDraft();
		// `openNewChatDraft` reuses the current draft when the footer is already
		// visible, so a draft left over from a prior test keeps its typed text.
		// Start from an empty composer so the send-button state is deterministic.
		await this.clearMessage();
	}

	async clearMessage(): Promise<void> {
		await clear(this.messageInput());
	}

	async openWorkspaceSelector(): Promise<void> {
		await click(this.workspaceSelector());
	}

	async selectUnscopedWorkspace(): Promise<void> {
		await click(this.unscopedOption());
	}

	/**
	 * Registers a workspace for `folderPath` through the same renderer bridge
	 * `WorkspaceWatcherPage` uses, without its native-watcher wait: this is
	 * only to make the workspace appear in the picker, not to exercise file
	 * watching. Returns the created workspace's id for later cleanup.
	 */
	async createWorkspace(folderPath: string, name: string): Promise<string> {
		return await getPage().evaluate(
			async ({ folderPath, name }) => {
				type InvokeResult =
					| { ok: true; value: { id: string } }
					| { ok: false; error: { code: string; message: string } };
				type DesktopGlobal = typeof globalThis & {
					desktopApi: {
						invoke(
							channel: "feature:invoke",
							input: { featureId: string; channel: string; args?: unknown },
						): Promise<InvokeResult>;
					};
				};
				const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
					featureId: "kilo-ui",
					channel: "create",
					args: { name, folders: [{ path: folderPath, isPrimary: true }] },
				});
				if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
				return response.value.id;
			},
			{ folderPath, name },
		);
	}

	async removeWorkspace(workspaceId: string): Promise<void> {
		await getPage().evaluate(async (id) => {
			type InvokeResult =
				| { ok: true; value: { deleted: boolean } }
				| { ok: false; error: { code: string; message: string } };
			type DesktopGlobal = typeof globalThis & {
				desktopApi: {
					invoke(
						channel: "feature:invoke",
						input: { featureId: string; channel: string; args?: unknown },
					): Promise<InvokeResult>;
				};
			};
			const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
				featureId: "kilo-ui",
				channel: "remove",
				args: { id },
			});
			if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
		}, workspaceId);
	}

	async typeMessage(text: string): Promise<void> {
		await fill(this.messageInput(), text);
	}

	async verifyDraftFooterVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.draftFooter(),
			"Draft footer should render for a new chat with no messages",
		);
	}

	async verifyWorkspaceSelectorVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceSelector(),
			"Draft footer should show the 'Select workspace' combobox",
		);
	}

	async verifyUnscopedOptionVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.unscopedOption(),
			"Workspace selector should offer the 'No workspace' option",
		);
	}

	async verifyWorkspaceSelectorLabel(text: string): Promise<void> {
		await expectElementToHaveText(this.workspaceSelector(), text, {
			message: `Workspace selector should read "${text}"`,
		});
	}

	/** Trigger shows a leading folder icon, the "Select workspace" text, and a trailing chevron. */
	async verifyWorkspaceTriggerLabelAndIcons(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceSelectorLeadingIcon(),
			"Workspace selector should show a leading folder icon",
		);
		await expectElementToHaveText(
			this.workspaceSelector(),
			chatComposerData.workspaceSelector.triggerLabel,
			{
				message: `Workspace selector should read "${chatComposerData.workspaceSelector.triggerLabel}"`,
			},
		);
		await expectElementToBeVisible(
			this.workspaceSelectorTrailingIcon(),
			"Workspace selector should show a trailing chevron icon",
		);
	}

	async verifyWorkspaceSearchVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceSearchInput(),
			`Workspace selector should show a "${chatComposerData.workspaceSelector.searchPlaceholder}" search box`,
		);
	}

	async verifyNoWorkspaceOptionSelected(): Promise<void> {
		await expectElementToHaveText(
			this.unscopedOption(),
			chatComposerData.workspaceSelector.noWorkspaceLabel,
			{
				message: `Workspace selector should offer "${chatComposerData.workspaceSelector.noWorkspaceLabel}"`,
			},
		);
		await this.verifyWorkspaceRowChecked(this.unscopedOption());
	}

	async verifyNoWorkspacesYetMessage(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceListbox().getByText(chatComposerData.workspaceSelector.noWorkspacesYetMessage),
			`Workspace selector should show "${chatComposerData.workspaceSelector.noWorkspacesYetMessage}" when none exist`,
		);
	}

	async verifyNewWorkspaceOptionVisible(): Promise<void> {
		await expectElementToHaveText(
			this.newWorkspaceOption(),
			chatComposerData.workspaceSelector.newWorkspaceLabel,
			{
				message: `Workspace selector should offer "${chatComposerData.workspaceSelector.newWorkspaceLabel}"`,
			},
		);
	}

	async verifyWorkspaceRowVisible(workspaceName: string): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceRow(workspaceName),
			`Workspace selector should list the "${workspaceName}" workspace`,
		);
	}

	async verifyNoWorkspacesYetMessageHidden(): Promise<void> {
		await expectElementToBeHidden(
			this.workspaceListbox().getByText(chatComposerData.workspaceSelector.noWorkspacesYetMessage),
			`Workspace selector should not show "${chatComposerData.workspaceSelector.noWorkspacesYetMessage}" once workspaces exist`,
		);
	}

	private async verifyWorkspaceRowChecked(row: Locator): Promise<void> {
		await expectElementToHaveAttribute(row, "data-checked", "true", {
			message: "Workspace row should render as the currently selected option",
		});
	}

	async verifySendDisabled(): Promise<void> {
		// The send control is only rendered once the connection settles, so wait
		// for it to be visible before asserting its disabled state.
		await expectElementToBeVisible(
			this.sendButton(),
			"Send control should be present on an empty composer",
		);
		await expectElementToBeDisabled(
			this.sendButton(),
			"Send control should be disabled while the composer is empty",
		);
	}

	async verifySendEnabled(): Promise<void> {
		await expectElementToBeEnabled(
			this.sendButton(),
			"Send control should be enabled once the composer has a message",
		);
	}
}

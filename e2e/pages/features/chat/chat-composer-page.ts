import type { Locator } from "@playwright/test";
import {
	clear,
	click,
	expectElementToBeDisabled,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveAttribute,
	expectElementToHaveCount,
	expectElementToHaveText,
	fill,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	uploadFiles,
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
	private readonly addAttachmentButton = () =>
		getLocatorByRole("button", { name: "Add attachment" });
	// `ComposerPrimitive.AddAttachment` creates this input on click and appends
	// it to `document.body` hidden (assistant-ui's ComposerAddAttachment.js) —
	// it carries no data-qa-id, so it is targeted by its one stable attribute.
	// Not filtered to visible elements: the input is deliberately hidden.
	private readonly hiddenFileInput = () => getLocator('input[type="file"]', { onlyVisible: false });
	// Scoped to `.aui-composer-attachments` (ComposerAttachments in
	// attachment.tsx) so these locators see only unsent composer attachments,
	// never a sent message's attachments (UserMessageAttachments renders its
	// own tiles under `.aui-user-message-attachments-end`). Specs attach one
	// file per send, so `attachmentRoots()` is expected to match exactly one
	// element — strict mode throws if a future scenario attaches more than
	// one and a caller forgets to disambiguate, rather than silently acting
	// on the wrong one the way `.nth()`/`.first()` would.
	private readonly attachmentRoots = () =>
		getLocator(".aui-composer-attachments .aui-attachment-root", { onlyVisible: false });
	// `AttachmentPrimitive.Root` renders its tile and its Remove button as
	// *siblings*, not nested — so both are addressed via the shared root,
	// never via `.locator()` on the tile itself.
	private readonly attachmentTile = () => this.attachmentRoots().locator(".aui-attachment-tile");
	// The Remove button has no aria-label attribute — its accessible name
	// comes from a visually-hidden sr-only span ("Remove file" text content,
	// TooltipIconButton in attachment.tsx), confirmed against the rendered
	// DOM, so it is targeted by accessible name, not an aria-label selector.
	private readonly attachmentRemoveButton = () =>
		this.attachmentRoots().getByRole("button", { name: "Remove file" });
	private readonly attachmentErrorIcon = () =>
		this.attachmentTile().locator(".aui-attachment-tile-error");
	private readonly attachmentNameTooltip = () => getLocatorByRole("tooltip");
	// Current specs send exactly one message per test, so this is expected
	// to match exactly one assistant reply — strict mode throws rather than
	// silently grabbing the wrong one (`.last()`) if a future spec sends more
	// than once; such a spec should disambiguate explicitly instead.
	private readonly assistantMessage = () => getLocator('[data-role="assistant"]');

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

	async send(): Promise<void> {
		await click(this.sendButton());
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

	/**
	 * Clicks "Add attachment" (which synchronously creates and clicks a hidden
	 * file input — `ComposerAddAttachment.js`) then sets the file on that
	 * input directly, bypassing the native OS file picker Playwright cannot
	 * drive. `uploadFiles` targets the input by its CSS selector rather than
	 * waiting on a `filechooser` event, since the input already exists in the
	 * DOM by the time this method's own click returns.
	 */
	async addAttachment(filePath: string): Promise<void> {
		await click(this.addAttachmentButton());
		await uploadFiles(this.hiddenFileInput(), filePath, { onlyVisible: false });
	}

	/** Requires exactly one composer attachment — disambiguate at the call site (e.g. remove before attaching a second file) if a spec ever needs more than one. */
	async removeAttachment(): Promise<void> {
		await click(this.attachmentRemoveButton());
	}

	async hoverAttachment(): Promise<void> {
		await this.attachmentTile().hover();
	}

	async verifyAttachmentCount(count: number): Promise<void> {
		await expectElementToHaveCount(this.attachmentRoots(), count, {
			message: `Composer should show ${count} attachment tile(s)`,
		});
	}

	async verifyAttachmentVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.attachmentTile(),
			"Composer should show an attachment tile",
		);
	}

	/** Requires `hoverAttachment` first — the filename only renders inside the hover tooltip (`AttachmentPrimitive.Name`, attachment.tsx). */
	async verifyHoveredAttachmentName(name: string): Promise<void> {
		await expectElementToContainText(this.attachmentNameTooltip(), name, {
			message: `Attachment tooltip should show the filename "${name}"`,
		});
	}

	async verifyAttachmentErrored(): Promise<void> {
		await expectElementToBeVisible(
			this.attachmentErrorIcon(),
			"Attachment should show its error state",
		);
	}

	async verifyNoAttachmentErrored(): Promise<void> {
		await expectElementToBeHidden(
			this.attachmentErrorIcon(),
			"Attachment should not show an error state",
		);
	}

	/** Waits for the mock stub's reply text to render on the assistant message — proof the send reached the model and the reply round-tripped into the thread, not just that the stub received a request. */
	async verifyAssistantReplyVisible(replyText: string): Promise<void> {
		await expectElementToContainText(this.assistantMessage(), replyText, {
			message: `Assistant message should contain the stub's reply "${replyText}"`,
			timeout: chatComposerData.assistantReplyTimeoutMs,
		});
	}
}

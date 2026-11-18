import {
	clear,
	click,
	expectElementToBeDisabled,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveCount,
	fill,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	pressSequentially,
	uploadFiles,
} from "@anaconda/playwright-utils";

import {
	clearActiveWorkspace,
	createAndActivateWorkspace,
	openNewSession,
	sessionListRow,
	waitForSessionStartedBySend,
} from "./agent-session.js";

/** Session setup plus a round trip through the packaged Kilo CLI to the mock chat-completions stub, not a real model's latency. */
const ASSISTANT_REPLY_TIMEOUT_MS = 20_000;
/** Kilo asks for the chat's title after the reply; kilo.work-sessions then takes the title over. */
const SESSION_TITLED_TIMEOUT_MS = 30_000;

/**
 * The chat composer: typing, sending, attachments, and the session a first
 * send starts. Before the first send it is the New Session page's session
 * starter; from then on, the opened session's Agent pane.
 */
export class ChatComposerPage {
	private readonly agentPane = () => getLocatorByTestId("kilo-agent-pane");
	// Exactly one shows at a time: the launcher and an open session's canvas
	// never share the window, and hidden ones are filtered out.
	private readonly composerRoot = () =>
		getLocatorByTestId("kilo-session-starter").or(this.agentPane());
	private readonly thread = () => this.agentPane().getByTestId("kilo-chat-thread");
	private readonly messageInput = () => getLocatorByRole("textbox", { name: "Message input" });
	private readonly mentionChip = () =>
		this.composerRoot().locator('[data-slot="directive-text-chip"]');
	private readonly sendButton = () => getLocatorByTestId("kilo-composer-send");
	private readonly userMessage = (text: string) =>
		this.thread().locator('[data-role="user"]').getByText(text, { exact: true });
	private readonly addAttachmentButton = () =>
		this.composerRoot().getByTestId("kilo-composer-action-attach");
	// The attach action creates this input on click and appends it to
	// `document.body` hidden (builtin-actions.tsx) — it carries no data-qa-id,
	// so it is targeted by its one stable attribute, deliberately unfiltered
	// by visibility.
	private readonly hiddenFileInput = () => getLocator('input[type="file"]', { onlyVisible: false });
	// Scoped to `.aui-composer-attachments` so these see only unsent composer
	// attachments, never a sent message's (`.aui-user-message-attachments-end`).
	// Specs attach one file per send, so strict mode throws if a future scenario
	// attaches more without disambiguating.
	private readonly attachmentRoots = () =>
		this.composerRoot().locator(".aui-composer-attachments .aui-attachment-root");
	// `AttachmentPrimitive.Root` renders the tile and its Remove button as
	// siblings, so both are addressed via the shared root.
	private readonly attachmentTile = () => this.attachmentRoots().locator(".aui-attachment-tile");
	// The Remove button's accessible name comes from TooltipIconButton's
	// sr-only span ("Remove file"), not an aria-label attribute.
	private readonly attachmentRemoveButton = () =>
		this.attachmentRoots().getByRole("button", { name: "Remove file" });
	private readonly attachmentErrorIcon = () =>
		this.attachmentTile().locator(".aui-attachment-tile-error");
	private readonly attachmentNameTooltip = () => getLocatorByRole("tooltip");
	// Specs send one message per test, so strict mode throws rather than
	// grabbing the wrong reply if a future spec sends more than once.
	private readonly assistantMessage = () => this.thread().locator('[data-role="assistant"]');

	/** The New Session page's starter, in a fresh workspace for `folderPath`. */
	async openDraftInWorkspace(folderPath: string, name: string): Promise<void> {
		await createAndActivateWorkspace(folderPath, name);
		await this.openStarter();
		await expectElementToBeVisible(
			getLocatorByTestId("launcher-headline").getByText(name, { exact: true }),
			`The welcome headline should name the new session's workspace "${name}"`,
		);
	}

	/** The New Session page's starter, outside any workspace. */
	async openDraft(): Promise<void> {
		await clearActiveWorkspace();
		await this.openStarter();
	}

	/**
	 * The launcher stays mounted when New session is clicked on it, so text a
	 * previous test typed but never sent would still be in the starter.
	 */
	private async openStarter(): Promise<void> {
		await openNewSession();
		await clear(this.messageInput());
	}

	async typeMessage(text: string): Promise<void> {
		await fill(this.messageInput(), text);
	}

	/** Types one key at a time, so the rich input's `@` trigger sees the typing and opens its menu. */
	async typeMessageSequentially(text: string): Promise<void> {
		await pressSequentially(this.messageInput(), text);
	}

	/**
	 * Types `@query` into the composer and picks `fileName` from kilo.files'
	 * mention menu, leaving a chip in the composer for the send to resolve to
	 * the file's `@/path`.
	 */
	async mentionFile(query: string, fileName: string): Promise<void> {
		await this.typeMessageSequentially(`@${query}`);
		await click(getLocatorByRole("option", { name: fileName, exact: false }));
	}

	/** The composer holds a mention chip for `fileName`. */
	async verifyComposerMention(fileName: string): Promise<void> {
		await expectElementToContainText(this.mentionChip(), fileName, {
			message: `The composer should show a mention chip for "${fileName}"`,
		});
	}

	/** Sends what the composer holds, e.g. a mention chip added after its text. */
	async sendComposer(): Promise<void> {
		await click(this.sendButton());
	}

	async send(text: string): Promise<void> {
		await this.typeMessage(text);
		await click(this.sendButton());
	}

	/**
	 * Clicks "Add attachment" (which synchronously creates and clicks a hidden
	 * file input) then sets the file on that input directly, bypassing the
	 * native OS file picker Playwright cannot drive.
	 */
	async addAttachment(filePath: string): Promise<void> {
		await click(this.addAttachmentButton());
		await uploadFiles(this.hiddenFileInput(), filePath, { onlyVisible: false });
	}

	/** Requires exactly one composer attachment. */
	async removeAttachment(): Promise<void> {
		await click(this.attachmentRemoveButton());
	}

	async hoverAttachment(): Promise<void> {
		await this.attachmentTile().hover();
	}

	async verifySendDisabled(): Promise<void> {
		await expectElementToBeDisabled(this.sendButton(), {
			message: "Send should be disabled while the composer is empty",
		});
	}

	async verifySendEnabled(): Promise<void> {
		await expectElementToBeEnabled(this.sendButton(), {
			message: "Send should be enabled once the composer has text",
		});
	}

	/** The first send started the session and its chat: the session opened with the message in its transcript. */
	async verifyChatStarted(text: string): Promise<void> {
		await waitForSessionStartedBySend();
		await expectElementToBeVisible(
			this.userMessage(text),
			`"${text}" should show in the transcript`,
		);
		await expectElementToBeHidden(getLocatorByRole("alert").getByText("Could not start the chat"), {
			message: "Starting the chat should not fail",
		});
	}

	/** Requires the session to be open (after `verifyChatStarted`). */
	async verifySessionInWorkspace(name: string): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("session-breadcrumb").getByText(name, { exact: true }),
			`The session header should name the session's workspace "${name}"`,
		);
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

	/** Requires `hoverAttachment` first — the filename only renders inside the hover tooltip (attachment.tsx). */
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

	/** The stub's reply rendered on the assistant message — the send reached the model and the reply round-tripped into the thread. */
	async verifyAssistantReplyVisible(replyText: string): Promise<void> {
		await expectElementToContainText(this.assistantMessage(), replyText, {
			message: `Assistant message should contain the stub's reply "${replyText}"`,
			timeout: ASSISTANT_REPLY_TIMEOUT_MS,
		});
	}

	/**
	 * The work session took its chat's title: its session list row and the
	 * open session's header name it. Requires the session to be open.
	 */
	async verifySessionTitled(title: string): Promise<void> {
		await expectElementToBeVisible(sessionListRow(title), {
			message: `The session list should name the session "${title}" after its chat's title`,
			timeout: SESSION_TITLED_TIMEOUT_MS,
		});
		await expectElementToBeVisible(
			getLocatorByTestId("session-breadcrumb").getByText(title, { exact: true }),
			`The session header should name the session "${title}"`,
		);
	}
}

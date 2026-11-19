import {
	click,
	expectElementToBeVisible,
	expectElementToHaveCount,
	expectElementToHaveText,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";

import {
	AGENT_PANE_KIND,
	clearActiveWorkspace,
	openAgentPaneInNewSession,
	openNewSession,
	openNewSessionInNewWorkspace,
} from "./agent-session.js";

async function boxOf(locator: Locator, name: string) {
	const box = await locator.boundingBox();
	expect(box, `${name} should be laid out`).not.toBeNull();
	return box!;
}

/**
 * A new chat before its first message. On the New Session page it is
 * kilo.chat's session starter under the welcome headline and where the
 * session runs, with the other pane kinds (when any plugin adds them)
 * offered as tools below.
 * An Agent pane added to an existing session from its header is the in-pane
 * draft, its composer docked at the bottom of the pane.
 */
export class NewChatPage {
	private readonly launcher = () => getLocatorByTestId("workbench-launcher");
	private readonly headline = () => this.launcher().getByTestId("launcher-headline");
	private readonly starter = () =>
		this.launcher().getByTestId("launcher-session-starter").getByTestId("kilo-session-starter");
	private readonly starterInput = () => this.starter().getByTestId("kilo-composer-input");
	private readonly location = () => this.launcher().getByTestId("launcher-location");
	private readonly workspaceField = () =>
		this.location().getByRole("group", { name: "Workspace", exact: true });
	private readonly workspaceSelector = () =>
		this.workspaceField().getByTestId("launcher-workspace-selector");
	private readonly toolTile = (paneKind: string) =>
		this.launcher().getByTestId(`launcher-pane-${paneKind}`);
	private readonly agentPane = () => getLocatorByTestId("kilo-agent-pane");
	// Exactly one shows at a time: the launcher and an open session's canvas
	// never share the window, and hidden ones are filtered out.
	private readonly composerRoot = () =>
		getLocatorByTestId("kilo-session-starter").or(this.agentPane());
	private readonly thread = () => this.agentPane().getByTestId("kilo-chat-thread");
	private readonly dockedComposer = () => this.agentPane().getByTestId("kilo-composer-dock");
	private readonly messageInput = () => getLocatorByRole("textbox", { name: "Message input" });
	private readonly addAttachment = () => getLocatorByRole("button", { name: "Add attachment" });
	private readonly sendButton = () => getLocatorByTestId("kilo-composer-send");

	/** The New Session page outside any workspace. */
	async openNewSessionPage(): Promise<void> {
		await clearActiveWorkspace();
		await openNewSession();
	}

	async openNewSessionWithoutWorkspace(): Promise<void> {
		await openNewSession();
		await this.clearWorkspace();
	}

	async selectWorkspace(name: string): Promise<void> {
		await click(this.workspaceSelector());
		await click(getLocatorByRole("option", { name, exact: false }));
	}

	async clearWorkspace(): Promise<void> {
		await click(this.workspaceSelector());
		await click(getLocatorByTestId("workspace-unscoped-command", { onlyVisible: true }));
	}

	async verifySelectedWorkspace(name: string): Promise<void> {
		await expectElementToHaveText(this.workspaceSelector(), name, {
			message: `The workspace selector should show "${name}"`,
		});
	}

	async openNewSessionInWorkspace(folderPath: string, name: string): Promise<void> {
		await openNewSessionInNewWorkspace(folderPath, name);
	}

	async launchTool(paneKind: string): Promise<void> {
		await click(this.toolTile(paneKind));
	}

	async verifySessionOpened(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("session-workbench", { onlyVisible: true }),
			"The shortcut should open a new work session",
		);
		await expectElementToHaveCount(this.launcher(), 0, {
			message: "The launcher should be replaced by the new work session",
		});
	}

	/** An Agent pane added from the header of a new session outside any workspace. */
	async openAgentPaneDraft(): Promise<void> {
		await clearActiveWorkspace();
		await openAgentPaneInNewSession();
	}

	async verifyHeadlineAboveStarter(text: string): Promise<void> {
		await expectElementToBeVisible(
			this.headline().getByText(text, { exact: true }),
			`The New Session page should welcome with "${text}"`,
		);
		await expectElementToBeVisible(
			this.starterInput(),
			"The session starter should show the chat composer",
		);
		const headline = await boxOf(this.headline(), "The welcome headline");
		const starter = await boxOf(this.starter(), "The session starter");
		expect(
			headline.y + headline.height,
			"The welcome headline should sit above the session starter",
		).toBeLessThanOrEqual(starter.y);
	}

	/** Where the session will run — workspace first — between the headline and the starter. */
	async verifyLocationAboveStarter(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceSelector(),
			"The New Session page should show the workspace the session runs in",
		);
		const location = await boxOf(this.location(), "Where the session runs");
		const starter = await boxOf(this.starter(), "The session starter");
		expect(
			location.y + location.height,
			"Where the session runs should sit above the session starter",
		).toBeLessThanOrEqual(starter.y);
	}

	async verifyNoWorkspaceSelected(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceField(),
			"The New Session page should show the Workspace field above the composer",
		);
		await expectElementToHaveText(this.workspaceSelector(), "Select workspace", {
			message:
				"The workspace selector should show 'Select workspace' when no workspace is selected",
		});
	}

	async verifyToolTileBelowStarter(paneKind: string, title: string): Promise<void> {
		const tile = this.toolTile(paneKind);
		await expectElementToBeVisible(tile, `The New Session page should show the ${title} shortcut`);
		await expectElementToBeVisible(
			tile.getByText(title, { exact: true }),
			`The ${title} shortcut should display its title`,
		);
		const starter = await boxOf(this.starter(), "The session starter");
		const shortcut = await boxOf(tile, `The ${title} shortcut`);
		expect(
			shortcut.y,
			`The ${title} shortcut should sit below the session starter`,
		).toBeGreaterThanOrEqual(starter.y + starter.height);
	}

	/**
	 * The Agent is the starter itself, so it is never offered as a tool to
	 * start with (the other pane kinds return with their plugins).
	 */
	async verifyAgentNotOfferedAsTool(): Promise<void> {
		await expectElementToHaveCount(getLocatorByTestId(`launcher-pane-${AGENT_PANE_KIND}`), 0, {
			message: "The New Session page should not offer an Agent pane: the starter is the agent",
		});
	}

	/** The composer sits in the bottom quarter of the pane, not centred. */
	async verifyComposerDocked(): Promise<void> {
		await expectElementToBeVisible(this.dockedComposer(), "The new chat should show its composer");
		const pane = await boxOf(this.thread(), "The chat thread");
		const composer = await boxOf(this.dockedComposer(), "The composer");
		expect(
			composer.y + composer.height,
			"The new chat's composer should be docked at the bottom of the pane",
		).toBeGreaterThan(pane.y + pane.height * 0.75);
	}

	async verifyMessageInputVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.messageInput(),
			"Composer should show the 'Message input' textbox",
		);
	}

	/**
	 * The Lexical composer draws its placeholder as an element, not a
	 * `placeholder` attribute, and its wording grows with the installed
	 * mention sources, so this matches part of that element's text.
	 */
	async verifyComposerPlaceholder(text: string): Promise<void> {
		await expectElementToBeVisible(
			this.composerRoot().getByText(text),
			`Composer should show a placeholder containing '${text}'`,
		);
	}

	async verifyAddAttachmentVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.addAttachment(),
			"Composer toolbar should show the 'Add attachment' button",
		);
	}

	async verifySendVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.sendButton(),
			"Composer toolbar should show the Send control",
		);
	}
}

import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";

import { callDomainObject } from "../../utils/kernel-bridge.js";
import { runFromCommandPalette } from "../shell/command-palette.js";

/** kilo.work-sessions claims its own window calls; workspace methods are its own. */
export const WORK_SESSIONS_CALLER = "kilo.work-sessions";

/**
 * kilo.work-sessions' New Session page (the old "launcher"): what the main
 * area shows while no session is open. Without kilo.chat it has no session
 * starter; New empty session (command palette) starts a session without one.
 */
export class NewWorkSessionPage {
	private readonly page = () => getLocatorByTestId("workbench-launcher");
	private readonly headline = () => getLocatorByTestId("launcher-headline");

	/** The New Session page: the sidebar's New session button never opens a session itself. */
	async open(): Promise<void> {
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(this.page(), "New session should open the New Session page");
	}

	/** The page names the workspace its session will start in. */
	async verifyStartsIn(workspaceName: string): Promise<void> {
		await expectElementToBeVisible(
			this.headline().getByText(workspaceName, { exact: true }),
			`The New Session page should start the session in "${workspaceName}"`,
		);
	}

	/** Starts an empty session from the page (New empty session in the command palette). */
	async startEmptySession(): Promise<void> {
		await runFromCommandPalette("kilo.work-sessions/new-empty-work-session");
		await expectElementToBeVisible(
			getLocatorByTestId("session-workbench", { onlyVisible: true }),
			"Starting an empty session should open it",
		);
	}

	/** Opens the New Session page and starts an empty session from it. */
	async openAndStartEmptySession(): Promise<void> {
		await this.open();
		await this.startEmptySession();
	}
}

/** Registers a workspace (test setup) and makes it the one new sessions start in. */
export async function createAndActivateWorkspace(
	folderPath: string,
	name: string,
): Promise<string> {
	const workspace = (await callDomainObject({
		domainId: "kilo.work-sessions/workspaces",
		method: "create",
		input: { name, folders: [{ path: folderPath, isPrimary: true }] },
		caller: WORK_SESSIONS_CALLER,
	})) as { id: string };
	await callDomainObject({
		domainId: "kilo.work-sessions/workspaces",
		method: "setActive",
		input: { id: workspace.id },
		caller: WORK_SESSIONS_CALLER,
	});
	return workspace.id;
}

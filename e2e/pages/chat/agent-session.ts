import {
	click,
	expectElementToBeVisible,
	getAttribute,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import { callDomainObject } from "../../utils/kernel-bridge.js";
import { runFromCommandPalette } from "../shell/command-palette.js";
import {
	createAndActivateWorkspace,
	WORK_SESSIONS_CALLER,
} from "../work-sessions/new-work-session-page.js";

export { createAndActivateWorkspace };

/** The Agent pane kind kilo.chat contributes to kilo.work-sessions. */
export const AGENT_PANE_KIND = "kilo.chat/agent";

/** kilo.chat may hold a live Kilo server connection (kilo.core's `SERVER_CLIENT_PLUGINS`). */
const CHAT_CALLER = "kilo.chat";

/**
 * A first send creates the work session (and its copy, when chosen), the
 * chat and its Agent pane, and opens the work session once the server
 * accepted the prompt — well over the default expect budget on a cold
 * packaged CLI.
 */
const FIRST_SEND_OPENS_SESSION_TIMEOUT_MS = 30_000;

const agentPane = () => getLocatorByTestId("kilo-agent-pane");

/** The New Session page: no work session exists yet, so it is never inside one. */
async function openLauncher(): Promise<void> {
	await click(getLocatorByTestId("new-chat"));
	await expectElementToBeVisible(
		getLocatorByTestId("workbench-launcher"),
		"New session should open the New Session page",
	);
}

/**
 * Opens the New Session page with kilo.chat's work session starter: the
 * welcome headline over the chat composer. No work session exists until the
 * first send (see `waitForSessionStartedBySend`).
 */
export async function openNewSession(): Promise<void> {
	await openLauncher();
	await expectElementToBeVisible(
		getLocatorByTestId("launcher-session-starter").getByTestId("kilo-session-starter"),
		"The New Session page should show the chat session starter",
	);
}

/**
 * The New Session page names the workspace its work session will start in,
 * once the window has the workspace that was just activated.
 */
export async function verifyNewSessionIn(workspaceName: string): Promise<void> {
	await expectElementToBeVisible(
		getLocatorByTestId("launcher-headline").getByText(workspaceName, { exact: true }),
		`The New Session page should start the session in "${workspaceName}"`,
	);
}

/** The New Session page, starting in a new workspace holding `folderPath`. */
export async function openNewSessionInNewWorkspace(
	folderPath: string,
	name: string,
): Promise<string> {
	await openNewSession();
	const workspaceId = await createAndActivateWorkspace(folderPath, name);
	await verifyNewSessionIn(name);
	return workspaceId;
}

/** The starter's first send opened its work session: the Agent pane replaced the New Session page. */
export async function waitForSessionStartedBySend(): Promise<void> {
	await expectElementToBeVisible(agentPane(), {
		message: "The first send should open the new session on its Agent pane",
		timeout: FIRST_SEND_OPENS_SESSION_TIMEOUT_MS,
	});
}

/**
 * Starts an empty work session from the New Session page (New empty session
 * in the command palette), without a first message.
 */
export async function startEmptySession(): Promise<void> {
	await openLauncher();
	await runFromCommandPalette("kilo.work-sessions/new-empty-work-session");
	await expectElementToBeVisible(
		getLocatorByTestId("session-workbench"),
		"Starting an empty session should open it",
	);
}

/**
 * An Agent pane added to an existing work session from its header's Agent
 * button (the in-pane draft, before its first message), in a new empty one.
 */
export async function openAgentPaneInNewSession(): Promise<void> {
	await startEmptySession();
	await click(getLocatorByTestId(`chat-pane-pinned-${AGENT_PANE_KIND}`));
	await click(getLocatorByTestId(`chat-pane-pinned-new-${AGENT_PANE_KIND}`));
	await expectElementToBeVisible(
		agentPane(),
		"Adding an Agent pane from the session header's Agent button should show it",
	);
}

/** Clears the active workspace (test setup), so new work sessions start without one. */
export async function clearActiveWorkspace(): Promise<void> {
	await callDomainObject({
		domainId: "kilo.work-sessions/workspaces",
		method: "setActive",
		input: { id: null },
		caller: WORK_SESSIONS_CALLER,
	});
}

/** How to reach the Kilo server (Basic auth), for reading what the UI created. */
export interface KiloServerConnection {
	readonly baseUrl: string;
	readonly username: string;
	readonly password: string;
	readonly globalDirectory: string;
}

export async function kiloServerConnection(): Promise<KiloServerConnection> {
	return (await callDomainObject({
		domainId: "kilo.core/server",
		method: "connect",
		caller: CHAT_CALLER,
	})) as KiloServerConnection;
}

/** The work session of the Agent pane on screen; after a starter's first send, once it opened. */
export async function shownAgentSessionId(): Promise<string> {
	await waitForSessionStartedBySend();
	const id = await getAttribute(agentPane(), "data-kilo-agent-session");
	if (!id) throw new Error("No agent pane is showing");
	return id;
}

/** Names a work session (test setup), so its session list row can be found. */
export async function renameWorkSession(id: string, title: string): Promise<void> {
	await callDomainObject({
		domainId: "kilo.work-sessions/work-sessions",
		method: "rename",
		input: { id, title },
		caller: WORK_SESSIONS_CALLER,
	});
}

/** Deletes a work session and its chats (test cleanup). */
export async function removeWorkSession(id: string): Promise<void> {
	await callDomainObject({
		domainId: "kilo.work-sessions/work-sessions",
		method: "remove",
		input: { id },
		caller: WORK_SESSIONS_CALLER,
	});
}

/** The session list row of the work session titled `title`. */
export function sessionListRow(title: string) {
	return getLocatorByTestId("kilo-thread-list")
		.getByTestId(/^session-list-(archived-)?item$/)
		.filter({ hasText: title });
}

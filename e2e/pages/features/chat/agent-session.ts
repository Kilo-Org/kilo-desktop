import {
	click,
	expectElementToBeVisible,
	getAttribute,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import { callDomainMethod } from "../../../utils/kernel-domains.js";

export const AGENT_PANE_KIND = "kilo.chat/agent";

/**
 * A first send creates the Work Session (and its worktree, when chosen), the
 * chat and its Agent pane, and opens the session once the server accepted
 * the prompt — well over the default expect budget on a cold packaged CLI.
 */
const FIRST_SEND_OPENS_SESSION_TIMEOUT_MS = 30_000;

const agentPane = () => getLocatorByTestId("kilo-agent-pane");

/** The New Session page: no session exists yet, so it is never inside one. */
async function openLauncher(): Promise<void> {
	await click(getLocatorByTestId("new-chat"));
	await expectElementToBeVisible(
		getLocatorByTestId("workbench-launcher"),
		"New session should open the launcher",
	);
}

/**
 * Opens the New Session page with kilo.chat's session starter: the welcome
 * headline over the chat composer. No session exists until the first send
 * (see `waitForSessionStartedBySend`).
 */
export async function openNewSession(): Promise<void> {
	await openLauncher();
	await expectElementToBeVisible(
		getLocatorByTestId("launcher-session-starter").getByTestId("kilo-session-starter"),
		"The New Session page should show the chat session starter",
	);
}

/**
 * The New Session page names the workspace its session will start in, once
 * the window has the workspace that was just activated.
 */
export async function verifyNewSessionIn(workspaceName: string): Promise<void> {
	await expectElementToBeVisible(
		getLocatorByTestId("launcher-headline").getByText(workspaceName, { exact: true }),
		`The New Session page should start the session in "${workspaceName}"`,
	);
}

/**
 * The New Session page in a newly registered, active workspace. New session
 * from an open session starts in that session's workspace, so the page opens
 * before the workspace is activated.
 */
export async function openNewSessionInNewWorkspace(
	folderPath: string,
	name: string,
): Promise<string> {
	await openNewSession();
	const workspaceId = await createAndActivateWorkspace(folderPath, name);
	await verifyNewSessionIn(name);
	return workspaceId;
}

/** The starter's first send opened its session: the Agent pane replaced the New Session page. */
export async function waitForSessionStartedBySend(): Promise<void> {
	await expectElementToBeVisible(agentPane(), {
		message: "The first send should open the new session on its Agent pane",
		timeout: FIRST_SEND_OPENS_SESSION_TIMEOUT_MS,
	});
}

/**
 * Starts an empty session from the New Session page's quiet row (shown in e2e
 * builds through `new-session-pane-kinds`), without a first message.
 */
export async function startEmptySession(): Promise<void> {
	await openLauncher();
	await click(getLocatorByTestId("launcher-start-session"));
	await expectElementToBeVisible(
		getLocatorByTestId("session-workbench"),
		"Starting an empty session should open it",
	);
}

/**
 * An Agent pane added to an existing session from the session header (the
 * in-pane draft, before its first message), in a new empty session.
 */
export async function openAgentPaneInNewSession(): Promise<void> {
	await startEmptySession();
	await click(getLocatorByTestId(`chat-pane-pinned-${AGENT_PANE_KIND}`));
	await expectElementToBeVisible(
		agentPane(),
		"Adding an Agent pane from the session header should show it",
	);
}

/** Registers a workspace (test setup) and makes it the one new sessions start in. */
export async function createAndActivateWorkspace(
	folderPath: string,
	name: string,
): Promise<string> {
	const workspace = (await callDomainMethod(
		"kilo.workspaces/workspace",
		"create",
		{ name, folders: [{ path: folderPath, isPrimary: true }] },
		"kilo.workspaces",
	)) as { id: string };
	await callDomainMethod(
		"kilo.workspaces/workspace",
		"setActive",
		{ id: workspace.id },
		"kilo.workspaces",
	);
	return workspace.id;
}

/** Clears the active workspace (test setup), so new sessions start without one. */
export async function clearActiveWorkspace(): Promise<void> {
	await callDomainMethod("kilo.workspaces/workspace", "setActive", { id: null }, "kilo.workspaces");
}

/** How to reach the Kilo server (Basic auth), for reading what the UI created. */
export interface KiloServerConnection {
	readonly baseUrl: string;
	readonly username: string;
	readonly password: string;
}

export async function kiloServerConnection(): Promise<KiloServerConnection> {
	return (await callDomainMethod(
		"kilo.agent/server",
		"connect",
		undefined,
		"kilo.chat",
	)) as KiloServerConnection;
}

/** The Work Session of the Agent pane on screen; after a starter's first send, once it opened. */
export async function shownAgentSessionId(): Promise<string> {
	await waitForSessionStartedBySend();
	const id = await getAttribute(agentPane(), "data-kilo-agent-session");
	if (!id) throw new Error("No agent pane is showing");
	return id;
}

/** Names a Work Session (test setup), so its session list row can be found. */
export async function renameWorkSession(id: string, title: string): Promise<void> {
	await callDomainMethod("kilo.sessions/session", "rename", { id, title }, "kilo.sessions");
}

/** Deletes a Work Session and its chats (test cleanup). */
export async function removeWorkSession(id: string): Promise<void> {
	await callDomainMethod("kilo.sessions/session", "remove", { id }, "kilo.sessions");
}

/** The session list row of the Work Session titled `title`. */
export function sessionListRow(title: string) {
	return getLocatorByTestId("kilo-thread-list")
		.getByTestId(/^session-list-(archived-)?item$/)
		.filter({ hasText: title });
}

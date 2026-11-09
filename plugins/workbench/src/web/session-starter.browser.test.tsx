import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { PaneKind, type IsolationOptions } from "@kilo-desktop/plugin-sessions/contracts";

import {
	Workbench,
	SessionStarter,
	type SessionStarterProps,
	type StartedSession,
} from "../contracts";
import { renderWorkbench, workspace } from "../test/fakes";

const WAIT = { timeout: 5_000 };

const REPOSITORY: IsolationOptions = {
	directory: "/projects/app",
	currentBranch: "main",
	defaultBranch: "main",
	branches: [{ name: "main", kind: "local", ref: "refs/heads/main", upstream: null }],
	recentBranches: [],
	worktrees: [],
};

let started: StartedSession[] = [];
let failures: unknown[] = [];
let lastProps: SessionStarterProps | undefined;

beforeEach(() => {
	started = [];
	failures = [];
	lastProps = undefined;
});

/** A starter that starts a session on "Send". */
function TestStarter(props: SessionStarterProps) {
	lastProps = props;
	return (
		<div data-qa-id="test-starter">
			<button
				type="button"
				onClick={() =>
					void props.start().then(
						(session) => started.push(session),
						(error) => failures.push(error),
					)
				}
			>
				Send
			</button>
		</div>
	);
}

const starterPlugin = {
	manifest: testManifest("test.starter", {
		contributes: {
			extensions: {
				"kilo.workbench/session-starter": [
					{ id: "composer", title: "Composer", paneKind: "test.kinds/agent" },
				],
			},
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(SessionStarter, "composer", TestStarter);
		},
	},
};

const kindsPlugin = {
	manifest: testManifest("test.kinds", {
		contributes: {
			extensions: {
				"kilo.sessions/pane-kind": [
					{ id: "agent", title: "Agent", launch: { newSession: true }, order: 10 },
					{
						id: "terminal",
						title: "Terminal",
						description: "Run commands in an interactive shell.",
						launch: { newSession: true },
						openCommand: "test.kinds/open-terminal",
					},
					{
						id: "notebook",
						title: "Notebook",
						launch: { newSession: true },
						availableWhen: { all: ["test.kinds/signedIn"] },
						unavailableHint: "Sign in to use notebooks.",
					},
				],
				"kernel/command": [
					{
						id: "open-terminal",
						title: "Open terminal",
						keybinding: "Mod+Shift+T",
						when: { all: ["kilo.workbench/paneTargetActive"] },
					},
				],
			},
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(KernelCommand, "open-terminal", () =>
				sdk.domains.get(Workbench)?.methods.openPane({ kind: "test.kinds/terminal" }),
			);
			sdk.extensions.implement(PaneKind, "agent", { component: () => null });
			sdk.extensions.implement(PaneKind, "terminal", { component: () => null });
			sdk.extensions.implement(PaneKind, "notebook", { component: () => null });
		},
	},
};

function renderNewSession(options: { isolation?: IsolationOptions | null } = {}) {
	return renderWorkbench({
		workspaces: [workspace("w-app", "App")],
		activeWorkspaceId: "w-app",
		guests: [starterPlugin, kindsPlugin],
		...options,
	});
}

const follows = (first: Element, second: Element) =>
	Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the New Session page with a session starter", () => {
	it("says where the session runs in one labelled row, between the headline and the starter", async () => {
		await renderNewSession({ isolation: REPOSITORY });

		const location = page.getByTestId("launcher-location");
		// Each group's text is its screen-reader label, then its value.
		await expect.element(location).toHaveTextContent("WorkspaceAppUseCurrent checkoutBranchmain");
		const starter = page.getByTestId("test-starter");
		expect(follows(page.getByTestId("launcher-headline").element(), location.element())).toBe(true);
		expect(follows(location.element(), starter.element())).toBe(true);
		expect(lastProps).toMatchObject({ workspaceId: "w-app", directory: "/projects/app" });
	});

	it("draws each label inside its picker, so the picker's menu opens under the label", async () => {
		await renderNewSession({ isolation: REPOSITORY });

		const checkout = page.getByTestId("git-draft-mode-trigger");
		await expect.element(checkout).toBeVisible();
		expect(getComputedStyle(checkout.element(), "::before").content).toBe('"Use"');
		await checkout.click();
		await expect.element(page.getByTestId("git-draft-mode-item-worktree")).toBeVisible();
		await userEvent.keyboard("{Escape}");
	});

	it("offers the other pane kinds under the starter, their shortcuts shown on hover", async () => {
		await renderNewSession();

		const terminal = page.getByTestId("launcher-pane-test.kinds/terminal");
		await expect.element(terminal.getByText("Terminal", { exact: true })).toBeVisible();
		await expect
			.element(terminal)
			.toHaveAttribute("title", "Run commands in an interactive shell.");
		expect(page.getByTestId("launcher-pane-test.kinds/agent").query()).toBeNull();
		expect(follows(page.getByTestId("test-starter").element(), terminal.element())).toBe(true);
		expect(page.getByTestId("launcher-start-session").query()).toBeNull();
	});

	it("shows why a tool can't be started in its place", async () => {
		await renderNewSession();

		const notebook = page.getByTestId("launcher-pane-test.kinds/notebook");
		await expect.element(notebook).toBeDisabled();
		await expect.element(notebook).toHaveAttribute("title", "Sign in to use notebooks.");
	});

	it("shows a tool's open shortcut as keycaps on hover, and only for tools that have one", async () => {
		await page.viewport(1280, 800);
		await renderNewSession();

		const terminal = page.getByTestId("launcher-pane-test.kinds/terminal");
		const keys = terminal.getByTestId("launcher-pane-shortcut");
		await expect.element(keys).toBeInTheDocument();
		expect(getComputedStyle(keys.element()).opacity).toBe("0");
		await terminal.hover();
		await vi.waitFor(() => expect(getComputedStyle(keys.element()).opacity).toBe("1"));
		const caps = [...keys.element().querySelectorAll("kbd")].map((cap) => cap.textContent);
		expect(caps).toHaveLength(3);
		expect(caps.at(-1)).toBe("T");
		expect(
			page
				.getByTestId("launcher-pane-test.kinds/notebook")
				.getByTestId("launcher-pane-shortcut")
				.query(),
		).toBeNull();
	});

	it("starts a session with a tool from its open shortcut", async () => {
		const { host, sessions, navigator } = await renderNewSession({ isolation: REPOSITORY });
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toBeVisible();

		await host.renderer.commands.execute("test.kinds/open-terminal");

		await vi.waitFor(
			() =>
				expect(sessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "local" },
				}),
			WAIT,
		);
		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("wses_1"), WAIT);
	});

	it("starts and opens a session with a tool where the location row says", async () => {
		const { sessions, navigator } = await renderNewSession({ isolation: REPOSITORY });
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toBeVisible();

		await page.getByTestId("launcher-pane-test.kinds/terminal").click();

		await vi.waitFor(
			() =>
				expect(sessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "local" },
				}),
			WAIT,
		);
		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("wses_1"), WAIT);
		expect(started).toEqual([]);
	});

	it("starts the session where the location row says without showing it, until asked to", async () => {
		const { sessions, navigator } = await renderNewSession({ isolation: REPOSITORY });
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toBeVisible();

		await page.getByRole("button", { name: "Send" }).click();

		await vi.waitFor(() => expect(started).toHaveLength(1), WAIT);
		expect(sessions.calls.create).toHaveBeenCalledWith({
			workspaceId: "w-app",
			isolation: { kind: "local" },
		});
		expect(started[0]).toMatchObject({ sessionId: "wses_1", workspaceId: "w-app" });
		expect(navigator().getState().activeSessionId).toBeNull();
		await expect.element(page.getByTestId("test-starter")).toBeVisible();

		await started[0]!.open();

		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("wses_1"), WAIT);
		await expect.element(page.getByTestId("test-starter")).not.toBeInTheDocument();
	});

	it("discards a session the starter couldn't use, with a worktree it made", async () => {
		const { sessions } = await renderNewSession({ isolation: REPOSITORY });
		await page.getByTestId("git-draft-mode-trigger").click();
		await page.getByTestId("git-draft-mode-item-worktree").click();

		await page.getByRole("button", { name: "Send" }).click();
		await vi.waitFor(() => expect(started).toHaveLength(1), WAIT);
		await started[0]!.discard();

		expect(sessions.calls.remove).toHaveBeenCalledWith("wses_1");
		expect(sessions.calls.removeWorktree).toHaveBeenCalledWith("wses_1");
	});

	it("rejects a start that fails, leaving the page as it was", async () => {
		const { sessions } = await renderNewSession();
		sessions.failNextWith("Disk full");

		await page.getByRole("button", { name: "Send" }).click();

		await vi.waitFor(() => expect(failures).toHaveLength(1), WAIT);
		expect(started).toEqual([]);
		await expect.element(page.getByTestId("test-starter")).toBeVisible();
		expect(lastProps?.starting).toBe(false);
	});
});

describe("the New Session page while a worktree is being created", () => {
	async function inNewWorktree() {
		const host = await renderNewSession({ isolation: REPOSITORY });
		await page.getByTestId("git-draft-mode-trigger").click();
		await page.getByTestId("git-draft-mode-item-worktree").click();
		return host;
	}

	it("says so over the page, which takes no input until the session is open", async () => {
		const { sessions, navigator } = await inNewWorktree();
		const release = sessions.holdNextCreate();

		await page.getByTestId("launcher-pane-test.kinds/terminal").click();

		const progress = page.getByTestId("launcher-isolation-progress");
		await expect.element(progress).toHaveTextContent("Creating a worktree from main…");
		await userEvent.keyboard("{Escape}");
		await expect.element(progress).toBeVisible();
		await expect.element(page.getByTestId("launcher-body")).toHaveAttribute("inert");
		await expect.element(page.getByTestId("launcher-pane-test.kinds/terminal")).toBeDisabled();
		await expect.element(page.getByTestId("launcher-workspace-selector")).toBeDisabled();
		expect(lastProps?.starting).toBe(true);

		release();

		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("wses_1"), WAIT);
		expect(sessions.calls.create).toHaveBeenCalledTimes(1);
	});

	it("keeps waiting, over the page, until the starter opens the session it started", async () => {
		const { sessions, navigator } = await inNewWorktree();
		const release = sessions.holdNextCreate();

		await page.getByRole("button", { name: "Send" }).click();
		await vi.waitFor(() => expect(sessions.calls.create).toHaveBeenCalledTimes(1), WAIT);
		await expect.element(page.getByTestId("launcher-pane-test.kinds/terminal")).toBeDisabled();
		await expect(lastProps!.start()).rejects.toThrow("A session is already starting.");

		release();

		await vi.waitFor(() => expect(started).toHaveLength(1), WAIT);
		const progress = page.getByTestId("launcher-isolation-progress");
		await expect.element(progress).toHaveTextContent("Opening the session…");
		await expect.element(page.getByTestId("launcher-body")).toHaveAttribute("inert");

		await started[0]!.open();

		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("wses_1"), WAIT);
		await expect.element(progress).not.toBeInTheDocument();
		expect(sessions.calls.create).toHaveBeenCalledTimes(1);
	});

	it("takes input again once the starter discards the session it started", async () => {
		const { sessions } = await inNewWorktree();

		await page.getByRole("button", { name: "Send" }).click();
		await vi.waitFor(() => expect(started).toHaveLength(1), WAIT);
		await started[0]!.discard();

		await expect.element(page.getByTestId("launcher-isolation-progress")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("launcher-body")).not.toHaveAttribute("inert");
		expect(sessions.calls.remove).toHaveBeenCalledWith("wses_1");
	});
});

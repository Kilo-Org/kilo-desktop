import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";

import {
	PaneKind,
	WorkSessions,
	WorkSessionsWindow,
	NewWorkSessionSection,
	WorkSessionStarter,
	type IsolationOptions,
	type NewWorkSessionSectionProps,
	type StartedWorkSession,
	type WorkSession,
	type WorkSessionStarterProps,
} from "../../contracts";
import { renderWorkSessions, workSession, workspace } from "../../testing";

const WAIT = { timeout: 5_000 };

const REPOSITORY: IsolationOptions = {
	directory: "/projects/app",
	currentBranch: "main",
	defaultBranch: "main",
	branches: [{ name: "main", kind: "local", ref: "refs/heads/main", upstream: null }],
	recentBranches: [],
	copies: [],
};

let started: StartedWorkSession[] = [];
let failures: unknown[] = [];
let lastProps: WorkSessionStarterProps | undefined;

beforeEach(() => {
	started = [];
	failures = [];
	lastProps = undefined;
});

/** A starter that starts a session on "Send". */
function TestStarter(props: WorkSessionStarterProps) {
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
				"kilo.work-sessions/work-session-starter": [
					{ id: "composer", title: "Composer", paneKind: "test.kinds/agent" },
				],
			},
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(WorkSessionStarter, "composer", TestStarter);
		},
	},
};

const kindsPlugin = {
	manifest: testManifest("test.kinds", {
		contributes: {
			extensions: {
				"kilo.work-sessions/pane-kind": [
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
						when: { all: ["kilo.work-sessions/paneTargetActive"] },
					},
				],
			},
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(KernelCommand, "open-terminal", () =>
				sdk.domainObjects
					.get(WorkSessionsWindow)
					?.methods.openPane({ kind: "test.kinds/terminal" }),
			);
			sdk.extensions.implement(PaneKind, "agent", { component: () => null });
			sdk.extensions.implement(PaneKind, "terminal", { component: () => null });
			sdk.extensions.implement(PaneKind, "notebook", { component: () => null });
		},
	},
};

let sectionStarted: StartedWorkSession[] = [];

/** A section that starts a session from its own button. */
function TestSection(props: NewWorkSessionSectionProps) {
	return (
		<button
			type="button"
			data-qa-id="test-section"
			disabled={props.disabled}
			onClick={() => void props.start().then((session) => sectionStarted.push(session))}
		>
			From a section in {props.workspaceId}
		</button>
	);
}

const sectionPlugin = {
	manifest: testManifest("test.section", {
		contributes: { extensions: { "kilo.work-sessions/new-work-session-section": [{ id: "s" }] } },
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(NewWorkSessionSection, "s", TestSection);
		},
	},
};

function renderNewSession(
	options: { isolation?: IsolationOptions | null; workSessions?: WorkSession[] } = {},
) {
	return renderWorkSessions({
		workspaces: [workspace("w-app", "App")],
		activeWorkspaceId: "w-app",
		guests: [starterPlugin, kindsPlugin],
		...options,
	});
}

const openRow = (title: string) =>
	page
		.getByTestId("kilo-thread-list")
		.getByTestId("session-list-item")
		.filter({ hasText: title })
		.getByTestId("session-list-item-trigger")
		.click();

const follows = (first: Element, second: Element) =>
	Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the New Session page with a session starter", () => {
	it("asks the starter to take focus each time New session is clicked on the page", async () => {
		await renderNewSession();
		await expect.element(page.getByTestId("test-starter")).toBeVisible();
		expect(lastProps?.focusRequest).toBeFalsy();

		await page.getByTestId("new-chat").click();
		await vi.waitFor(() => expect(lastProps?.focusRequest).toBeTruthy(), WAIT);
		const first = lastProps!.focusRequest;

		await page.getByTestId("new-chat").click();
		await vi.waitFor(() => expect(lastProps?.focusRequest).not.toBe(first), WAIT);
		expect(lastProps?.focusRequest).toBeTruthy();
	});

	it("asks the starter New session shows from an open session to take focus", async () => {
		await renderNewSession({ workSessions: [workSession("a", { workspaceId: "w-app" })] });
		await openRow("Session a");
		await expect.element(page.getByTestId("test-starter")).not.toBeInTheDocument();

		await page.getByTestId("new-chat").click();

		await expect.element(page.getByTestId("test-starter")).toBeVisible();
		expect(lastProps?.focusRequest).toBeTruthy();
	});

	it("doesn't ask again when the page shows without New session", async () => {
		const { host } = await renderNewSession({
			workSessions: [workSession("a", { workspaceId: "w-app" })],
		});
		await page.getByTestId("new-chat").click();
		await vi.waitFor(() => expect(lastProps?.focusRequest).toBeTruthy(), WAIT);
		await openRow("Session a");
		await expect.element(page.getByTestId("test-starter")).not.toBeInTheDocument();

		await host.renderer.kernelSdk.domainObjects.get(WorkSessions)!.methods.remove({ id: "a" });

		await expect.element(page.getByTestId("test-starter")).toBeVisible();
		expect(lastProps?.focusRequest).toBeFalsy();
	});

	it("says where the session runs in one labelled row, between the headline and the starter", async () => {
		await renderNewSession({ isolation: REPOSITORY });

		const location = page.getByTestId("launcher-location");
		// Each group's text is its screen-reader label, then its value.
		await expect.element(location).toHaveTextContent("WorkspaceAppUseLocal repositoryBranchmain");
		const starter = page.getByTestId("test-starter");
		expect(follows(page.getByTestId("launcher-headline").element(), location.element())).toBe(true);
		expect(follows(location.element(), starter.element())).toBe(true);
		expect(lastProps).toMatchObject({ workspaceId: "w-app", directory: "/projects/app" });
	});

	it("joins workspace, isolation and branch in one capsule, each label drawn in its picker", async () => {
		await renderNewSession({ isolation: REPOSITORY });

		const capsule = page.getByTestId("launcher-location-capsule");
		for (const label of ["Workspace", "Use", "Branch"]) {
			await expect.element(capsule.getByRole("group", { name: label })).toBeVisible();
		}
		const separator = (label: string) =>
			getComputedStyle(capsule.getByRole("group", { name: label }).element(), "::before").content;
		expect(separator("Use")).toBe('""');
		expect(separator("Workspace")).toBe("none");

		const checkout = page.getByTestId("git-draft-mode-trigger");
		expect(getComputedStyle(checkout.element(), "::before").content).toBe('"Use"');
		await checkout.click();
		await expect.element(page.getByTestId("git-draft-mode-item-worktree")).toBeVisible();
		await userEvent.keyboard("{Escape}");
	});

	it("shrinks the capsule's segments to fit a narrow row instead of clipping them", async () => {
		await renderNewSession({ isolation: REPOSITORY });
		const capsule = page.getByTestId("launcher-location-capsule");
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toBeVisible();

		page.getByTestId("launcher-location").element().setAttribute("style", "width: 360px");

		const capsuleBox = () => capsule.element().getBoundingClientRect();
		// Settled: the capsule has finished easing to its (row-capped) content width.
		await vi.waitFor(() =>
			expect(capsuleBox().width).toBeCloseTo(
				capsule.element().firstElementChild!.getBoundingClientRect().width,
				0,
			),
		);

		for (const button of capsule.element().querySelectorAll("button")) {
			expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(capsuleBox().right + 0.5);
		}
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
		const { host, workSessions, window } = await renderNewSession({ isolation: REPOSITORY });
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toBeVisible();

		await host.renderer.commands.execute("test.kinds/open-terminal");

		await vi.waitFor(
			() =>
				expect(workSessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "local" },
				}),
			WAIT,
		);
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("wses_1"), WAIT);
	});

	it("starts and opens a session with a tool where the location row says", async () => {
		const { workSessions, window } = await renderNewSession({ isolation: REPOSITORY });
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toBeVisible();

		await page.getByTestId("launcher-pane-test.kinds/terminal").click();

		await vi.waitFor(
			() =>
				expect(workSessions.calls.create).toHaveBeenCalledWith({
					workspaceId: "w-app",
					isolation: { kind: "local" },
				}),
			WAIT,
		);
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("wses_1"), WAIT);
		expect(started).toEqual([]);
	});

	it("shows sections under the tools, which start sessions where the location row says", async () => {
		sectionStarted = [];
		const { workSessions, window } = await renderWorkSessions({
			workspaces: [workspace("w-app", "App")],
			activeWorkspaceId: "w-app",
			guests: [starterPlugin, kindsPlugin, sectionPlugin],
			isolation: REPOSITORY,
		});
		await expect
			.element(page.getByTestId("launcher-section"))
			.toHaveTextContent("From a section in w-app");
		expect(
			follows(
				page.getByTestId("launcher-pane-test.kinds/terminal").element(),
				page.getByTestId("launcher-section").element(),
			),
		).toBe(true);

		await page.getByTestId("launcher-section").getByRole("button").click();

		await vi.waitFor(() => expect(sectionStarted).toHaveLength(1), WAIT);
		expect(workSessions.calls.create).toHaveBeenCalledWith({
			workspaceId: "w-app",
			isolation: { kind: "local" },
		});
		await sectionStarted[0]!.open();
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("wses_1"), WAIT);
	});

	it("starts the session where the location row says without showing it, until asked to", async () => {
		const { workSessions, window } = await renderNewSession({ isolation: REPOSITORY });
		await expect.element(page.getByTestId("git-draft-mode-trigger")).toBeVisible();

		await page.getByRole("button", { name: "Send" }).click();

		await vi.waitFor(() => expect(started).toHaveLength(1), WAIT);
		expect(workSessions.calls.create).toHaveBeenCalledWith({
			workspaceId: "w-app",
			isolation: { kind: "local" },
		});
		expect(started[0]).toMatchObject({ workSessionId: "wses_1", workspaceId: "w-app" });
		expect(window().getState().activeWorkSessionId).toBeNull();
		await expect.element(page.getByTestId("test-starter")).toBeVisible();

		await started[0]!.open();

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("wses_1"), WAIT);
		await expect.element(page.getByTestId("test-starter")).not.toBeInTheDocument();
	});

	it("discards a session the starter couldn't use, with a worktree it made", async () => {
		const { workSessions } = await renderNewSession({ isolation: REPOSITORY });
		await page.getByTestId("git-draft-mode-trigger").click();
		await page.getByTestId("git-draft-mode-item-worktree").click();

		await page.getByRole("button", { name: "Send" }).click();
		await vi.waitFor(() => expect(started).toHaveLength(1), WAIT);
		await started[0]!.discard();

		expect(workSessions.calls.remove).toHaveBeenCalledWith("wses_1");
		expect(workSessions.calls.removeCopy).toHaveBeenCalledWith("wses_1");
	});

	it("rejects a start that fails, leaving the page as it was", async () => {
		const { workSessions } = await renderNewSession();
		workSessions.failNextWith("Disk full");

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
		const { workSessions, window } = await inNewWorktree();
		const release = workSessions.holdNextCreate();

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

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("wses_1"), WAIT);
		expect(workSessions.calls.create).toHaveBeenCalledTimes(1);
	});

	it("keeps waiting, over the page, until the starter opens the session it started", async () => {
		const { workSessions, window } = await inNewWorktree();
		const release = workSessions.holdNextCreate();

		await page.getByRole("button", { name: "Send" }).click();
		await vi.waitFor(() => expect(workSessions.calls.create).toHaveBeenCalledTimes(1), WAIT);
		await expect.element(page.getByTestId("launcher-pane-test.kinds/terminal")).toBeDisabled();
		await expect(lastProps!.start()).rejects.toThrow("A session is already starting.");

		release();

		await vi.waitFor(() => expect(started).toHaveLength(1), WAIT);
		const progress = page.getByTestId("launcher-isolation-progress");
		await expect.element(progress).toHaveTextContent("Opening the session…");
		await expect.element(page.getByTestId("launcher-body")).toHaveAttribute("inert");

		await started[0]!.open();

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("wses_1"), WAIT);
		await expect.element(progress).not.toBeInTheDocument();
		expect(workSessions.calls.create).toHaveBeenCalledTimes(1);
	});

	it("takes input again once the starter discards the session it started", async () => {
		const { workSessions } = await inNewWorktree();

		await page.getByRole("button", { name: "Send" }).click();
		await vi.waitFor(() => expect(started).toHaveLength(1), WAIT);
		await started[0]!.discard();

		await expect.element(page.getByTestId("launcher-isolation-progress")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("launcher-body")).not.toHaveAttribute("inert");
		expect(workSessions.calls.remove).toHaveBeenCalledWith("wses_1");
	});
});

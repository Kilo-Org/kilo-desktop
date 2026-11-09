import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { PaneKind, type IsolationOptions } from "@kilo-desktop/plugin-sessions/contracts";

import { SessionStarter, type SessionStarterProps, type StartedSession } from "../contracts";
import { renderWorkbench, workspace } from "../test/fakes";
import { NEW_SESSION_PANE_KINDS_FLAG } from "./home/Launcher";

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

/** A starter that draws the footer it is given and starts a session on "Send". */
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
			{props.footer}
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
					{ id: "terminal", title: "Terminal", launch: { newSession: true } },
				],
			},
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(PaneKind, "agent", { component: () => null });
			sdk.extensions.implement(PaneKind, "terminal", { component: () => null });
		},
	},
};

/** kilo.flags with the named flags on. */
function flagsPlugin(on: readonly string[]) {
	return {
		manifest: testManifest("kilo.flags", { contextKeys: [{ id: "flag:*", scope: "global" }] }),
		main: {
			activate(sdk: PluginSdk) {
				for (const flag of on) sdk.context.set(`flag:${flag}`, true);
			},
		},
	};
}

function renderNewSession(
	options: { isolation?: IsolationOptions | null; flags?: readonly string[] } = {},
) {
	const { flags = [], ...rest } = options;
	return renderWorkbench({
		workspaces: [workspace("w-app", "App")],
		activeWorkspaceId: "w-app",
		guests: [starterPlugin, kindsPlugin, flagsPlugin(flags)],
		...rest,
	});
}

const follows = (first: Element, second: Element) =>
	Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the New Session page with a session starter", () => {
	it("puts the starter under the welcome headline, with where the session runs in its footer", async () => {
		await renderNewSession({ isolation: REPOSITORY });

		const starter = page.getByTestId("test-starter");
		await expect.element(starter.getByTestId("git-draft-mode-trigger")).toHaveTextContent("Local");
		await expect
			.element(starter.getByTestId("launcher-workspace-selector"))
			.toHaveTextContent("App");
		expect(follows(page.getByTestId("launcher-headline").element(), starter.element())).toBe(true);
		expect(lastProps).toMatchObject({ workspaceId: "w-app", directory: "/projects/app" });
	});

	it("offers no pane-kind buttons beside the starter, as origin's page didn't", async () => {
		await renderNewSession();
		await expect.element(page.getByTestId("test-starter")).toBeVisible();

		expect(page.getByTestId(/^launcher-pane-/).query()).toBeNull();
		expect(page.getByTestId("launcher-start-session").query()).toBeNull();
	});

	it("offers the other pane kinds and an empty session under the starter behind a flag", async () => {
		await renderNewSession({ flags: [NEW_SESSION_PANE_KINDS_FLAG] });

		await expect.element(page.getByTestId("launcher-pane-test.kinds/terminal")).toBeVisible();
		await expect
			.element(page.getByTestId("launcher-start-session"))
			.toHaveTextContent("Empty session");
		expect(page.getByTestId("launcher-pane-test.kinds/agent").query()).toBeNull();
		expect(
			follows(
				page.getByTestId("test-starter").element(),
				page.getByTestId("launcher-pane-test.kinds/terminal").element(),
			),
		).toBe(true);
	});

	it("starts the session where the footer says without showing it, until asked to", async () => {
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

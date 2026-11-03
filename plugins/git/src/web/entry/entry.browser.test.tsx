import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { WhenExpression } from "@kilo-desktop/kernel";
import { PaneKind } from "@kilo-desktop/plugin-sessions/contracts";

import { CHANGES_PANE_KIND } from "../../contracts/index.js";
import {
	bootGitHost,
	ChangesPaneHost,
	patchResponseStream,
	resetViewTestDom,
	stubFetch,
	WAIT,
	waitForTreePath,
	type ChangesHostOptions,
} from "../../test/changes-host.js";

afterEach(resetViewTestDom);

async function changesKind(options: ChangesHostOptions = {}) {
	const host = await bootGitHost(options);
	const kind = host.renderer.extensions
		.list(PaneKind)
		.find((candidate) => candidate.key === CHANGES_PANE_KIND)!;
	const available = () =>
		host.renderer.kernelSdk.context.evaluate(kind.metadata.availableWhen as WhenExpression);
	return { host, kind, available };
}

describe("the Changes pane kind", () => {
	it("is one per session, opened from inside a session", async () => {
		const { kind } = await changesKind();

		expect(kind.metadata).toMatchObject({
			title: "Changes",
			singleton: true,
			launch: { newSession: false, inSession: true },
			availableWhen: { all: ["kilo.workspaces/vcs"] },
		});
	});

	it("is available only while a version control provider is", async () => {
		await expect(changesKind({ vcs: true }).then(({ available }) => available())).resolves.toBe(
			true,
		);
		await expect(changesKind({ vcs: false }).then(({ available }) => available())).resolves.toBe(
			false,
		);
	});

	it("shows the changes of the session's directory", async () => {
		const fetchMock = stubFetch(() => new Response(patchResponseStream()));
		const host = await bootGitHost({
			folders: [{ path: "/workspace/project", isPrimary: true }],
		});

		host.render(<ChangesPaneHost host={host} directory="/workspace/project/.kilo/worktrees/fix" />);

		await waitForTreePath("README.md");
		expect(fetchMock).toHaveBeenCalledWith(
			`kilo-git://diff/patch?cwd=${encodeURIComponent("/workspace/project/.kilo/worktrees/fix")}`,
			expect.anything(),
		);
	});
});

describe("Open Changes", () => {
	const OPEN_CHANGES = "kilo.git/open-changes";
	const available = (host: Awaited<ReturnType<typeof bootGitHost>>) =>
		host.renderer.commands.list().some((command) => command.key === OPEN_CHANGES);

	it("is Ctrl+Shift+G while a session is open", async () => {
		const host = await bootGitHost();
		const command = host.renderer.commands
			.declared()
			.find((candidate) => candidate.key === OPEN_CHANGES);

		expect(command?.metadata).toMatchObject({ title: "Open Changes", keybinding: "Ctrl+Shift+G" });
		expect(available(host)).toBe(true);
		expect(available(await bootGitHost({ activeSessionId: null }))).toBe(false);
		expect(available(await bootGitHost({ vcs: false }))).toBe(false);
	});

	it("opens the Changes pane of the window's session", async () => {
		const host = await bootGitHost({ activeSessionId: "wses_1" });

		await host.renderer.commands.execute(OPEN_CHANGES);

		await vi.waitFor(
			() => expect(host.opened).toEqual([{ sessionId: "wses_1", kind: CHANGES_PANE_KIND }]),
			WAIT,
		);
	});

	it("shows or opens it through kilo.workbench when that is here (pop-outs, telemetry)", async () => {
		const paneLauncher = vi.fn();
		const host = await bootGitHost({ activeSessionId: "wses_1", paneLauncher });

		await host.renderer.commands.execute(OPEN_CHANGES);

		await vi.waitFor(
			() => expect(paneLauncher).toHaveBeenCalledWith({ kind: CHANGES_PANE_KIND }),
			WAIT,
		);
		expect(host.opened).toEqual([]);
	});
});

describe("worktree branch renames", () => {
	it("are toasted in the main window only", async () => {
		const host = await bootGitHost();
		host.render(<div />);

		await host.emitBranchRenamed("/workspace/project/.kilo/worktrees/a", "kilo/fix-login");
		await expect.element(page.getByText("Branch renamed to kilo/fix-login")).toBeVisible();

		host.renderer.kernelSdk.context.set("secondaryWindow", true);
		await host.emitBranchRenamed("/workspace/project/.kilo/worktrees/a", "kilo/other");
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(page.getByText("Branch renamed to kilo/other").query()).toBeNull();
	});
});

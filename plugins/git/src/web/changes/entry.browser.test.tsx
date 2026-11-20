import { afterEach, describe, expect, it, vi } from "vitest";

import type { WhenExpression } from "@kilo-desktop/kernel";
import { PaneKind } from "@kilo-desktop/plugin-work-sessions/contracts";

import { CHANGES_PANE_KIND, GIT_COMMANDS } from "../../contracts";
import {
	bootGitHost,
	ChangesPaneHost,
	patchResponseStream,
	resetViewTestDom,
	stubFetch,
	WAIT,
	waitForTreePath,
	WORK_SESSION_ID,
	type GitHost,
	type GitHostOptions,
} from "../../test/git-host";

afterEach(resetViewTestDom);

async function changesKind(options: GitHostOptions = {}) {
	const host = await bootGitHost(options);
	const kind = host.renderer.extensions
		.list(PaneKind)
		.find((candidate) => candidate.key === CHANGES_PANE_KIND)!;
	const available = () =>
		host.renderer.kernelSdk.context.evaluate(kind.metadata.availableWhen as WhenExpression);
	return { host, kind, available };
}

describe("the Changes pane kind", () => {
	it("is one per work session, opened from inside a work session", async () => {
		const { kind } = await changesKind();

		expect(kind.metadata).toMatchObject({
			title: "Changes",
			singleton: true,
			launch: { newSession: false, inSession: true },
			availableWhen: { all: ["kilo.work-sessions/hasVcs"] },
		});
	});

	it("is available only while a version control contribution is", async () => {
		await expect(changesKind({ vcs: true }).then(({ available }) => available())).resolves.toBe(
			true,
		);
		await expect(changesKind({ vcs: false }).then(({ available }) => available())).resolves.toBe(
			false,
		);
	});

	it("shows the changes of the work session's directory", async () => {
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
	const available = (host: GitHost) =>
		host.renderer.commands.list().some((command) => command.key === GIT_COMMANDS.openChanges);

	it("is Ctrl+Shift+G while a work session is open", async () => {
		const host = await bootGitHost();
		const command = host.renderer.commands
			.declared()
			.find((candidate) => candidate.key === GIT_COMMANDS.openChanges);

		expect(command?.metadata).toMatchObject({ title: "Open Changes", keybinding: "Ctrl+Shift+G" });
		expect(available(host)).toBe(true);
		expect(available(await bootGitHost({ activeWorkSessionId: null }))).toBe(false);
		expect(available(await bootGitHost({ vcs: false }))).toBe(false);
	});

	it("opens the Changes pane of the window's work session", async () => {
		const host = await bootGitHost({ activeWorkSessionId: WORK_SESSION_ID });

		await host.renderer.commands.execute(GIT_COMMANDS.openChanges);

		await vi.waitFor(
			() =>
				expect(host.opened).toEqual([{ workSessionId: WORK_SESSION_ID, kind: CHANGES_PANE_KIND }]),
			WAIT,
		);
	});

	it("shows or opens it in its own tab group through the work sessions window (pop-outs, telemetry)", async () => {
		const openPane = vi.fn();
		const host = await bootGitHost({ activeWorkSessionId: WORK_SESSION_ID, openPane });

		await host.renderer.commands.execute(GIT_COMMANDS.openChanges);

		await vi.waitFor(
			() => expect(openPane).toHaveBeenCalledWith({ kind: CHANGES_PANE_KIND, placement: "group" }),
			WAIT,
		);
		expect(host.opened).toEqual([]);
	});
});

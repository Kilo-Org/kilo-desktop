import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelWindows } from "@kilo-desktop/kernel";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import {
	PANE_WINDOW_VIEW,
	WorkSessionAction,
	type WorkSession,
	type WorkSessionActionProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { AGENT_PANE_KIND, chatPaneObject, paneChatId } from "../../contracts";
import { agentPane, chatSummary, renderAgentPane, workSession } from "../../test/chat-host";
import { workSessionChats } from "./AgentsMenu";
import { agentPanesWeb } from "./test-agent-panes";

const WORK_SESSION = workSession({ chatIds: ["ses_old", "ses_older", "ses_new", "ses_popped"] });
const TITLES: Record<string, string> = {
	ses_old: "Fix login",
	ses_older: "Audit icons",
	ses_new: "Add tests",
	ses_popped: "Refactor tokens",
};

function hostWindows() {
	return {
		open: vi.fn(async () => "w9"),
		focus: vi.fn(),
		close: vi.fn(),
		setHidden: vi.fn(),
		focusMain: vi.fn(),
	};
}

/** The Agents button as kilo.work-sessions' header renders it. */
async function renderButton(open: readonly string[] = ["ses_new", "ses_popped"]) {
	const windows = hostWindows();
	const paneOf = (chatId: string) =>
		agentPane({ id: `pane_${chatId}`, object: chatPaneObject(chatId) });
	const [last, ...others] = [...open].reverse();
	const host = await renderAgentPane({
		chatWeb: agentPanesWeb,
		workSession: WORK_SESSION,
		windows,
		pane: paneOf(last!),
		otherPanes: others.reverse().map(paneOf),
		chats: Object.keys(TITLES).map((id, index) =>
			chatSummary(id, {
				title: TITLES[id]!,
				updatedAt: id === "ses_older" ? 0 : index + 1,
				workSessionId: WORK_SESSION.id,
			}),
		),
	});
	const { renderer, main } = host.host;
	if (open.includes("ses_popped")) {
		await renderer.kernelSdk.domainObjects.get(KernelWindows)!.methods.open({
			view: PANE_WINDOW_VIEW,
			key: `${WORK_SESSION.id}/pane_ses_popped`,
			params: { workSessionId: WORK_SESSION.id, paneId: "pane_ses_popped" },
		});
		main.windowEvents.opened("w9", { role: "secondary", view: PANE_WINDOW_VIEW });
	}
	const contribution = renderer.extensions
		.list(WorkSessionAction)
		.find((candidate) => candidate.key.endsWith("agents"))!;
	render(
		<KernelProvider kernel={renderer}>
			{/* Lifted over the test shell, as the header is. */}
			<div className="relative z-50">
				<RenderContribution<WorkSessionActionProps>
					contribution={contribution}
					props={{ workSession: WORK_SESSION }}
				/>
			</div>
		</KernelProvider>,
	);
	return { ...host, windows };
}

describe("the Agents button", () => {
	it("lists open chats, then closed ones newest first, marking a popped-out chat", async () => {
		await renderButton();

		await page.getByTestId("agents-menu-button").click();

		await expect.element(page.getByRole("group", { name: "Open" })).toBeVisible();
		const open = page.getByRole("group", { name: "Open" }).getByRole("menuitem");
		const closed = page.getByRole("group", { name: "Closed" }).getByRole("menuitem");
		expect(open.elements().map((item) => item.textContent)).toEqual([
			"Add tests",
			"Refactor tokens",
		]);
		await expect
			.element(
				page.getByTestId("agents-menu-ses_popped").getByRole("img", { name: "In its own window" }),
			)
			.toBeVisible();
		expect(page.getByTestId("agents-menu-ses_new").getByRole("img").query()).toBeNull();
		expect(closed.elements().map((item) => item.textContent)).toEqual(["Fix login", "Audit icons"]);
	});

	it("shows an open chat's tab, or brings its window forward", async () => {
		const { panes, windows } = await renderButton();

		await page.getByTestId("agents-menu-button").click();
		await page.getByTestId("agents-menu-ses_new").click();
		await vi.waitFor(() => expect(panes().activePaneId).toBe("pane_ses_new"));

		await page.getByTestId("agents-menu-button").click();
		await page.getByTestId("agents-menu-ses_popped").click();
		await vi.waitFor(() => expect(windows.focus).toHaveBeenCalledWith("w9"));
	});

	it("reopens a closed chat as a tab of the active group", async () => {
		const { panes, sessions } = await renderButton();

		await page.getByTestId("agents-menu-button").click();
		await page.getByTestId("agents-menu-ses_old").click();

		await vi.waitFor(() =>
			expect(panes().panes.find((pane) => paneChatId(pane) === "ses_old")).toMatchObject({
				kind: AGENT_PANE_KIND,
			}),
		);
		expect(sessions.calls.open).toHaveBeenCalledWith(expect.objectContaining({ placement: "tab" }));
	});

	it("starts a new agent as a draft tab of the active group", async () => {
		const { panes, sessions } = await renderButton();
		const before = panes().panes.length;

		await page.getByTestId("agents-menu-button").click();
		await page.getByTestId("agents-menu-new").click();

		await vi.waitFor(() => expect(panes().panes).toHaveLength(before + 1));
		const opened = panes().panes.at(-1)!;
		expect(opened.kind).toBe(AGENT_PANE_KIND);
		expect(paneChatId(opened)).toBeNull();
		expect(sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({ kind: AGENT_PANE_KIND, placement: "tab" }),
		);
	});

	it("leaves the Closed section out when every chat is open", async () => {
		await renderButton(Object.keys(TITLES));

		await page.getByTestId("agents-menu-button").click();

		await expect.element(page.getByRole("group", { name: "Open" })).toBeVisible();
		expect(page.getByRole("group", { name: "Closed" }).query()).toBeNull();
	});
});

describe("workSessionChats", () => {
	it("keeps the work session's root chats, newest first", () => {
		const own: Pick<WorkSession, "id" | "chatIds"> = { id: "wses_1", chatIds: ["ses_a"] };
		const chats = {
			ses_a: chatSummary("ses_a", { updatedAt: 1 }),
			ses_b: chatSummary("ses_b", { updatedAt: 3, workSessionId: "wses_1" }),
			ses_child: chatSummary("ses_child", { parentId: "ses_a", workSessionId: "wses_1" }),
			ses_other: chatSummary("ses_other", { workSessionId: "wses_2" }),
		};

		expect(workSessionChats(own, chats).map((chat) => chat.id)).toEqual(["ses_b", "ses_a"]);
	});
});

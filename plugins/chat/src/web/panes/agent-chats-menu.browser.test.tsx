import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import { Panes, type WorkSession } from "@kilo-desktop/plugin-sessions/contracts";
import { PaneKindMenu, type PaneKindMenuProps } from "@kilo-desktop/plugin-workbench/contracts";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";

import { AGENT_PANE_KIND, CHAT_ID_METADATA_KEY } from "../../contracts";
import { agentPane, chatSummary, renderAgentPane, session } from "../../test/chat-host";
import { sessionChats } from "./AgentChatsMenu";

const SESSION = session({ chatIds: ["ses_old", "ses_new"] });

/** The agent button's menu as kilo.workbench's session header renders it. */
async function renderMenu() {
	const host = await renderAgentPane({
		session: SESSION,
		pane: agentPane({ id: "pane_new", metadata: { [CHAT_ID_METADATA_KEY]: "ses_new" } }),
		chats: [
			chatSummary("ses_old", { title: "Fix login", updatedAt: 1, workSessionId: SESSION.id }),
			chatSummary("ses_new", { title: "Add tests", updatedAt: 2, workSessionId: SESSION.id }),
		],
	});
	const { renderer } = host.host;
	const contribution = renderer.extensions
		.list(PaneKindMenu)
		.find((candidate) => candidate.metadata.paneKind === AGENT_PANE_KIND)!;
	render(
		<KernelProvider kernel={renderer}>
			<DropdownMenu>
				{/* Lifted over the test shell, as the panes are. */}
				<DropdownMenuTrigger data-qa-id="agent-menu" className="relative z-50">
					Agent
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<RenderContribution<PaneKindMenuProps>
						contribution={contribution}
						props={{ session: SESSION }}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</KernelProvider>,
	);
	await page.getByTestId("agent-menu").click();
	return host;
}

describe("the agent button's chats", () => {
	it("lists the session's chats newest first, marking the open one", async () => {
		await renderMenu();

		const items = page.getByRole("menuitem");
		await expect.element(items.first()).toHaveTextContent("Add tests");
		await expect.element(items.nth(1)).toHaveTextContent("Fix login");
		await expect
			.element(page.getByTestId("agent-chat-ses_new").getByLabelText("Open"))
			.toBeVisible();
		expect(page.getByTestId("agent-chat-ses_old").getByLabelText("Open").query()).toBeNull();
	});

	it("reopens a closed chat in a new agent pane", async () => {
		const host = await renderMenu();

		await page.getByTestId("agent-chat-ses_old").click();

		await vi.waitFor(() =>
			expect(
				host.panes().panes.find((pane) => pane.metadata[CHAT_ID_METADATA_KEY] === "ses_old"),
			).toMatchObject({ kind: AGENT_PANE_KIND }),
		);
	});

	it("shows an open chat's pane instead of opening another", async () => {
		const host = await renderMenu();
		await host.host.renderer.kernelSdk.domains
			.get(Panes)!
			.methods.open({ sessionId: SESSION.id, kind: AGENT_PANE_KIND, paneId: "pane_draft" });

		await page.getByTestId("agent-chat-ses_new").click();

		await vi.waitFor(() => expect(host.panes().activePaneId).toBe("pane_new"));
		expect(host.panes().panes.filter((pane) => pane.kind === AGENT_PANE_KIND)).toHaveLength(2);
	});
});

describe("sessionChats", () => {
	it("keeps the session's root chats, newest first", () => {
		const own: Pick<WorkSession, "id" | "chatIds"> = { id: "wses_1", chatIds: ["ses_a"] };
		const chats = {
			ses_a: chatSummary("ses_a", { updatedAt: 1 }),
			ses_b: chatSummary("ses_b", { updatedAt: 3, workSessionId: "wses_1" }),
			ses_child: chatSummary("ses_child", { parentId: "ses_a", workSessionId: "wses_1" }),
			ses_other: chatSummary("ses_other", { workSessionId: "wses_2" }),
		};

		expect(sessionChats(own, chats).map((chat) => chat.id)).toEqual(["ses_b", "ses_a"]);
	});
});

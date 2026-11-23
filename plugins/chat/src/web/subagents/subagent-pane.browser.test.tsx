import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { BackgroundJob, ChatSummary } from "@kilo-desktop/plugin-core/contracts";
import { Panes, type Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	chatPaneObject,
	SUBAGENT_PANE_KIND,
	SWARM_PANE_KIND,
	subagentPaneId,
	swarmPaneId,
} from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { toolPart } from "../../test/transcript";

const WAIT = { timeout: 15_000 };
const TASK = "Map the bridge RPC calls";

function server() {
	const fake = new FakeKiloServer();
	fake.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Map conda",
		messages: [
			userMessage("ses_a", "msg_1", "Map the bridge"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				toolPart(
					"task",
					{
						status: "completed",
						input: { description: "Map bridge RPC", subagent_type: "explore" },
						output: "<task_result>Done</task_result>",
						metadata: { sessionId: "ses_c1" },
					},
					"call_t1",
				),
			]),
		],
	});
	fake.addChat({
		id: "ses_c1",
		directory: "/projects/app",
		title: "Map bridge RPC (@explore subagent)",
		messages: [
			userMessage("ses_c1", "c_1", TASK),
			assistantMessage("ses_c1", "c_2", "c_1", [{ type: "text", text: "Reading the bridge" }]),
			userMessage("ses_c1", "c_3", "A later prompt"),
		],
	});
	return fake;
}

const workerPane: Pane = {
	id: subagentPaneId("ses_c1"),
	kind: SUBAGENT_PANE_KIND,
	title: "Map bridge RPC",
	metadata: {},
	object: chatPaneObject("ses_c1"),
	ordinal: 1,
};

const busy: ChatSummary["activity"] = {
	status: "busy",
	pendingPermissionIds: [],
	pendingQuestionIds: [],
};

const team = (worker: Partial<ChatSummary> = {}) => [
	chatSummary("ses_a", { title: "Map conda" }),
	chatSummary("ses_c1", {
		parentId: "ses_a",
		title: "Map bridge RPC (@explore subagent)",
		createdAt: 2,
		...worker,
	}),
];

const job = (patch: Partial<BackgroundJob> = {}): BackgroundJob => ({
	id: "job_1",
	type: "task",
	status: "running",
	chatId: "ses_c1",
	agent: "explore",
	model: "kilo/anthropic/claude-sonnet-4-5",
	startedAt: Date.now() - 192_000,
	...patch,
});

const header = () => page.getByTestId("subagent-pane-header");

describe("a worker's pane", () => {
	it("shows the worker's status, team, model and elapsed time, and stops its job", async () => {
		const host = await renderChat({
			server: server(),
			pane: workerPane,
			chats: team({ activity: busy }),
			jobs: { ses_a: [job()] },
		});

		await expect
			.element(header().getByTestId("subagent-pane-status"), WAIT)
			.toHaveTextContent("Working");
		await expect.element(header().getByText("Map bridge RPC", { exact: true })).toBeVisible();
		await expect
			.element(header().getByTestId("subagent-pane-model"))
			.toHaveTextContent("claude-sonnet-4-5");
		await expect
			.element(header().getByTestId("subagent-pane-elapsed"))
			.toMatchTextContent(/^3m \d\ds$/);
		await expect
			.element(header().getByTestId("subagent-pane-swarm-link"))
			.toHaveTextContent("Map conda");

		await header().getByTestId("subagent-pane-stop").click();

		await vi.waitFor(() =>
			expect(host.core.calls.cancelJob).toHaveBeenCalledWith({ chatId: "ses_a", jobId: "job_1" }),
		);
	});

	it("opens the team's Swarm Board from its title", async () => {
		const host = await renderChat({ server: server(), pane: workerPane, chats: team() });

		await header().getByTestId("subagent-pane-swarm-link").click(WAIT);

		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: SWARM_PANE_KIND,
				paneId: swarmPaneId("ses_a"),
				object: chatPaneObject("ses_a"),
			}),
		);
	});

	it("says a finished worker is done, without Stop, and how long it ran", async () => {
		const startedAt = Date.now() - 600_000;
		await renderChat({
			server: server(),
			pane: workerPane,
			chats: team(),
			jobs: {
				ses_a: [job({ status: "completed", startedAt, completedAt: startedAt + 42_000 })],
			},
		});

		await expect
			.element(header().getByTestId("subagent-pane-status"), WAIT)
			.toHaveTextContent("Done");
		await expect.element(header().getByTestId("subagent-pane-elapsed")).toHaveTextContent("42s");
		await expect.element(header().getByTestId("subagent-pane-stop")).not.toBeInTheDocument();
	});

	it("says the worker needs the person while a prompt waits on it", async () => {
		await renderChat({
			server: server(),
			pane: workerPane,
			chats: team(),
			teams: {
				ses_a: {
					truncated: false,
					members: [
						{
							chatId: "ses_c1",
							parentChatId: "ses_a",
							title: "Map bridge RPC (@explore subagent)",
							directory: "/projects/app",
							state: "busy",
							background: true,
							live: true,
							attention: ["question"],
							startedAt: Date.now() - 5_000,
						},
					],
				},
			},
		});

		await expect
			.element(header().getByTestId("subagent-pane-status"), WAIT)
			.toHaveTextContent("Needs you");
	});

	it("labels only its first prompt as the main agent's task", async () => {
		await renderChat({ server: server(), pane: workerPane, chats: team() });

		const transcript = page.getByTestId("subagent-pane-transcript");
		await expect.element(transcript.getByText("A later prompt"), WAIT).toBeVisible();
		const captions = transcript.getByTestId("kilo-user-message-caption");
		await expect.element(captions).toHaveTextContent("From the main agent");
		expect(captions.elements()).toHaveLength(1);
		const first = transcript.getByText(TASK).element();
		expect(
			captions.element().compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("points the person to the main agent and focuses its composer", async () => {
		const host = await renderChat({
			server: server(),
			pane: workerPane,
			otherPanes: [agentPane({ object: chatPaneObject("ses_a") })],
			chats: team(),
		});

		const footer = page.getByTestId("subagent-pane-footer");
		await expect
			.element(footer, WAIT)
			.toMatchTextContent(/Subagents are steered by the main agent\./);
		await footer.getByTestId("subagent-pane-steer").click();

		const panes = host.host.renderer.kernelSdk.domainObjects.get(Panes)!;
		await vi.waitFor(() =>
			expect(panes.getState().byWorkSession.wses_1?.activePaneId).toBe("pane_agent"),
		);
		await vi.waitFor(() =>
			expect(
				document.activeElement?.closest('[data-qa-id="pane-pane_agent"]') &&
					document.activeElement.getAttribute("contenteditable"),
			).toBe("true"),
		);
	});
});

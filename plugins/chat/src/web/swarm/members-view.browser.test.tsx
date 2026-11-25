import { QueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { BoardMessage, KiloServer } from "@kilo-desktop/plugin-core/contracts";

import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import type { ChatMirrorServices } from "../runtime/chat-mirror";
import { ChatServices } from "../runtime/chat-services";
import { MembersView, type MembersViewProps } from "./MembersView";
import type { TeamMember } from "./swarm-team";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const DIRECTORY = "/projects/app";

/** kilo.chat's window services over a fake Kilo server, as the pane gets them. */
function servicesFor(server: FakeKiloServer): ChatMirrorServices {
	server.install();
	const handle = {
		getState: () => ({ status: "ready" }),
		subscribe: () => () => {},
		methods: { connect: async () => server.connection },
	} as unknown as DomainObjectHandle<typeof KiloServer>;
	return {
		chat: new ChatServices(() => handle),
		queries: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	};
}

const main: TeamMember = {
	chatId: "ses_root",
	title: "Ship the webhook retries",
	main: true,
	state: "idle",
	needsYou: false,
};
const coder: TeamMember = {
	chatId: "ses_coder",
	title: "Fix retries",
	main: false,
	state: "working",
	needsYou: false,
	jobId: "ses_coder",
};
const reviewer: TeamMember = {
	chatId: "ses_reviewer",
	title: "Review the patch",
	main: false,
	state: "done",
	needsYou: false,
};
const asker: TeamMember = {
	chatId: "ses_asker",
	title: "Map the config",
	main: false,
	state: "working",
	needsYou: true,
	attention: ["question"],
};
const broken: TeamMember = {
	chatId: "ses_broken",
	title: "Migrate the schema",
	main: false,
	state: "failed",
	needsYou: false,
	error: "The model provider refused the request",
};
const halted: TeamMember = {
	chatId: "ses_halted",
	title: "Benchmark",
	main: false,
	state: "cancelled",
	needsYou: false,
};

const post = (id: string, from: string, to: string, body: string): BoardMessage => ({
	id,
	timestamp: Number(id.slice(1)),
	from,
	to,
	type: "INFO",
	body,
});

const POSTS: BoardMessage[] = [
	post("p1", "main", "ses_coder", "Start with the queue"),
	post("p2", "ses_coder", "main", "Queue retries need a backoff"),
	post("p3", "ses_coder", "ses_reviewer", "Can you check the backoff?"),
	post("p4", "ses_coder", "ALL", "Heads up: tests are slow"),
	post("p5", "ses_reviewer", "ses_coder", "Backoff looks right\nMore details"),
	post("p6", "ses_root", "ses_coder", "Thanks"),
];

function seedServer(): FakeKiloServer {
	const server = new FakeKiloServer();
	server.addChat({
		id: "ses_coder",
		directory: DIRECTORY,
		title: "Fix retries",
		messages: [
			userMessage("ses_coder", "msg_u1", "Add exponential backoff to webhook retries", 1),
			assistantMessage(
				"ses_coder",
				"msg_a1",
				"msg_u1",
				[
					{
						type: "tool",
						tool: "read",
						callID: "c1",
						state: {
							status: "completed",
							input: { filePath: `${DIRECTORY}/src/webhooks/queue.ts` },
							title: "src/webhooks/queue.ts",
							output: "",
							metadata: {},
							time: { start: 2, end: 3 },
						},
					},
					{
						type: "tool",
						tool: "edit",
						callID: "c2",
						state: {
							status: "completed",
							input: { filePath: `${DIRECTORY}/src/webhooks/retry.ts` },
							title: "src/webhooks/retry.ts",
							output: "",
							metadata: { filediff: { additions: 38, deletions: 12 } },
							time: { start: 3, end: 4 },
						},
					},
					{
						type: "tool",
						tool: "bash",
						callID: "c3",
						state: {
							status: "running",
							input: { command: "pnpm test webhooks" },
							time: { start: 5 },
						},
					},
				],
				2,
			),
		],
	});
	for (const member of [main, reviewer, asker, broken, halted]) {
		server.addChat({
			id: member.chatId,
			directory: DIRECTORY,
			title: member.title,
			messages: [userMessage(member.chatId, `msg_${member.chatId}`, `Task of ${member.title}`, 1)],
		});
	}
	return server;
}

function renderMembers(patch: Partial<MembersViewProps> = {}) {
	const server = seedServer();
	const handlers = {
		onOpen: vi.fn(),
		onShowPosts: vi.fn(),
		onOpenConversation: vi.fn(),
		onShowQuestion: vi.fn(),
		onStop: vi.fn(),
	};
	render(
		<MembersView
			team={[main, coder, reviewer, asker, broken, halted]}
			rootChatId="ses_root"
			services={servicesFor(server)}
			colorOf={() => "#6366F1"}
			messages={POSTS}
			numbers={new Map(POSTS.map((message, index) => [message.id, index + 1]))}
			directoryOf={() => DIRECTORY}
			updatedAtOf={() => 1}
			canOpen={() => true}
			{...handlers}
			{...patch}
		/>,
	);
	return { server, ...handlers };
}

const row = (chatId: string) =>
	page
		.getByTestId("swarm-members")
		.element()
		.querySelector<HTMLElement>(`[data-qa-id="swarm-member"][data-chat-id="${chatId}"]`)!;
const inRow = (chatId: string, qaId: string) =>
	row(chatId).querySelector<HTMLElement>(`[data-qa-id="${qaId}"]`);
const expand = async (chatId: string) => {
	inRow(chatId, "swarm-member-toggle")!.click();
	await expect
		.poll(() => inRow(chatId, "swarm-member-toggle")?.getAttribute("aria-expanded"))
		.toBe("true");
};

describe("MembersView", () => {
	it("lists the subagents with one status vocabulary, those needing a look first", async () => {
		renderMembers();
		await expect.element(page.getByTestId("swarm-members")).toBeVisible();
		const statuses = () =>
			page
				.getByTestId("swarm-member-status")
				.elements()
				.map((element) => element.textContent);
		expect(statuses()).toEqual(["Needs you", "Failed", "Working", "Done"]);
		expect(row("ses_root")).toBeNull();

		const more = page.getByTestId("swarm-members-more");
		await expect.element(more).toHaveTextContent("Show 1 more agent· Benchmark · all stopped");
		await more.click();
		expect(statuses()).toEqual(["Needs you", "Failed", "Working", "Done", "Stopped"]);
	});

	it("says what each member does now while collapsed", async () => {
		renderMembers();
		await expect
			.poll(() => inRow("ses_coder", "swarm-member-now")?.textContent)
			.toBe("Bash · pnpm test webhooks");
		expect(inRow("ses_reviewer", "swarm-member-now")?.textContent).toBe("Backoff looks right");
		expect(inRow("ses_broken", "swarm-member-now")?.textContent).toBe(
			"The model provider refused the request",
		);
	});

	it("reads only the chats it shows activity for", async () => {
		const { server } = renderMembers();
		await expect
			.poll(() => inRow("ses_coder", "swarm-member-now")?.textContent)
			.toBe("Bash · pnpm test webhooks");
		const read = server.requests
			.filter((request) => request.path.endsWith("/message"))
			.map((request) => request.path);
		expect(read).toContain("/session/ses_coder/message");
		expect(read).not.toContain("/session/ses_reviewer/message");
		expect(read).not.toContain("/session/ses_root/message");

		await expand("ses_reviewer");
		await expect
			.poll(() => inRow("ses_reviewer", "swarm-member-task")?.textContent)
			.toBe("Task of Review the patch");
	});

	it("shows the task, who it talks with and its recent activity when expanded", async () => {
		const { onOpenConversation } = renderMembers();
		await expand("ses_coder");

		await expect
			.poll(() => inRow("ses_coder", "swarm-member-task")?.textContent)
			.toBe("Add exponential backoff to webhook retries");
		const chips = [
			...inRow("ses_coder", "swarm-member-talking")!.querySelectorAll<HTMLElement>("button"),
		];
		expect(chips.map((chip) => chip.textContent)).toEqual([
			"Main agent · 3 posts",
			"Review the patch · 2 posts",
		]);
		const steps = [
			...row("ses_coder").querySelectorAll<HTMLElement>('[data-qa-id="swarm-member-step"]'),
		].map((step) => [...step.children].map((cell) => cell.textContent));
		expect(steps).toEqual([
			["Read", "src/webhooks/queue.ts", ""],
			["Edit", "src/webhooks/retry.ts", "+38 −12"],
			["Bash", "pnpm test webhooks", "running…"],
		]);

		chips[1]!.click();
		expect(onOpenConversation).toHaveBeenCalledWith("ses_coder", "ses_reviewer");
		chips[0]!.click();
		expect(onOpenConversation).toHaveBeenLastCalledWith("ses_coder", "main");
	});

	it("offers the person's open question as a chip", async () => {
		const { onShowQuestion } = renderMembers();
		await expand("ses_asker");
		const chip = inRow("ses_asker", "swarm-member-question")!;
		expect(chip.textContent).toBe("you · 1 question");
		chip.click();
		expect(onShowQuestion).toHaveBeenCalledWith("ses_asker");
	});

	it("hides Talking with for a member that exchanged no posts", async () => {
		renderMembers();
		await page.getByTestId("swarm-members-more").click();
		await expand("ses_halted");
		await expect
			.poll(() => inRow("ses_halted", "swarm-member-task")?.textContent)
			.toBe("Task of Benchmark");
		expect(inRow("ses_halted", "swarm-member-talking")).toBeNull();
	});

	it("offers Stop only for a member running a background job", async () => {
		const { onStop, onOpen, onShowPosts } = renderMembers();
		await expand("ses_coder");
		await expand("ses_reviewer");

		expect(inRow("ses_reviewer", "swarm-member-stop")).toBeNull();
		inRow("ses_coder", "swarm-member-stop")!.click();
		expect(onStop).toHaveBeenCalledWith(coder);

		inRow("ses_reviewer", "swarm-member-open")!.click();
		expect(onOpen).toHaveBeenCalledWith("ses_reviewer");
		inRow("ses_reviewer", "swarm-member-show-posts")!.click();
		expect(onShowPosts).toHaveBeenCalledWith("ses_reviewer");
	});

	it("disables Open when the transcript can't open, and shows the cost", async () => {
		renderMembers({ canOpen: (id) => id !== "ses_coder", costOf: () => 0.123 });
		await expand("ses_coder");
		expect(inRow("ses_coder", "swarm-member-open")).toHaveProperty("disabled", true);
		expect(inRow("ses_coder", "swarm-member-open")?.textContent).toBe("Open Fix retries");
		expect(inRow("ses_coder", "swarm-member-cost")?.textContent).toBe("$0.12");
	});
});

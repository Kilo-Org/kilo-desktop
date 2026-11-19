import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { chatPaneObject, SWARM_PANE_KIND, swarmPaneId } from "../../contracts";
import { chatSummary } from "../../test/chat-host";
import { FakeKiloServer } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { TeamRow } from "./team-section";
import type { TeamMember } from "./swarm-team";

const member: TeamMember = {
	chatId: "ses_main",
	title: "Review the environment selection and kernel restart workflow",
	main: true,
	state: "idle",
	needsYou: false,
};

afterEach(cleanup);

describe("Swarm team design", () => {
	it("opens the main agent with the keyboard when its transcript is available", async () => {
		const onOpen = vi.fn();
		render(
			<TeamRow member={member} color="var(--primary)" canOpen onOpen={onOpen} onStop={undefined} />,
		);

		const open = page.getByRole("button", { name: "Open Main agent transcript" });
		await expect.element(open).toBeVisible();
		(open.element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it("keeps model, agent type and latest post in keyboard-accessible details", async () => {
		render(
			<TeamRow
				member={{ ...member, main: false, agent: "explore", model: "provider/model-version" }}
				color="var(--primary)"
				canOpen
				onOpen={vi.fn()}
				onStop={undefined}
				lastPost="The kernel must restart after changing environments."
			/>,
		);
		expect(page.getByText("explore").query()).toBeNull();
		expect(page.getByText("provider/model-version").query()).toBeNull();

		const toggle = page.getByTestId("swarm-team-member-details-toggle");
		(toggle.element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
		await expect.element(page.getByText("explore")).toBeVisible();
		await expect.element(page.getByText("provider/model-version")).toBeVisible();
		await expect
			.element(page.getByText("The kernel must restart after changing environments."))
			.toBeVisible();
		await userEvent.keyboard("{Enter}");
		await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
	});

	it("opens the real attention request and disables unavailable transcript actions", async () => {
		const onOpen = vi.fn();
		const waiting = { ...member, needsYou: true, attention: ["permission"] as const };
		const view = render(
			<TeamRow
				member={waiting}
				color="var(--primary)"
				canOpen
				onOpen={onOpen}
				onStop={undefined}
			/>,
		);
		const attention = page.getByRole("button", { name: "Review permission request" });
		expect(attention.query()).not.toBeNull();
		await attention.click();
		expect(onOpen).toHaveBeenCalledOnce();

		view.rerender(
			<TeamRow
				member={waiting}
				color="var(--primary)"
				canOpen={false}
				onOpen={onOpen}
				onStop={undefined}
			/>,
		);
		await expect.element(attention).toBeDisabled();
		await expect
			.element(page.getByRole("button", { name: "Open Main agent transcript" }))
			.toBeDisabled();
	});
});

describe("Swarm timeline design", () => {
	it("selects a post with the keyboard before jumping to its source in Activity", async () => {
		const start = Date.UTC(2026, 10, 16, 9, 0);
		const server = new FakeKiloServer();
		server.addChat({
			id: "ses_main",
			directory: "/projects/app",
			title: "Review environment selection",
			messages: [],
		});
		await renderChat({
			server,
			pane: {
				id: swarmPaneId("ses_main"),
				kind: SWARM_PANE_KIND,
				title: "Swarm board",
				metadata: {},
				object: chatPaneObject("ses_main"),
				ordinal: 1,
			},
			chats: [
				chatSummary("ses_main", { createdAt: start }),
				chatSummary("ses_worker", { title: member.title, parentId: "ses_main", createdAt: start }),
			],
			boards: {
				ses_main: {
					ownerChatId: "ses_main",
					revision: 1,
					hasMore: false,
					messages: [
						{
							id: "post_result",
							timestamp: start + 60_000,
							from: "ses_worker",
							to: "main",
							type: "RESULT",
							body: "Environment switching preserves the selected kernel.\nRestart still requires confirmation.",
						},
					],
				},
			},
		});
		await page.getByTestId("swarm-timeline-toggle").click();
		const arrow = page.getByTestId("swarm-timeline-post");
		await expect.element(arrow).toBeVisible();
		(arrow.element() as SVGElement).focus();
		await userEvent.keyboard("{Enter}");
		const detail = page.getByTestId("swarm-timeline-detail");
		expect(detail.query()).not.toBeNull();
		await expect
			.poll(() => detail.element().textContent)
			.toContain("Restart still requires confirmation.");
		await expect.element(arrow).toHaveAttribute("aria-pressed", "true");
		await detail.getByRole("button", { name: "Open source in Activity" }).click();
		await expect
			.poll(() => page.getByTestId("swarm-board-message").element().textContent)
			.toContain("Restart still requires confirmation.");
		await expect.element(page.getByTestId("swarm-board-message")).toBeInViewport();
	});

	it("labels inferred periods honestly and lets the person expand earlier activity", async () => {
		const start = Date.UTC(2026, 10, 16, 9, 0);
		const server = new FakeKiloServer();
		server.addChat({
			id: "ses_main",
			directory: "/projects/app",
			title: "Review environment selection",
			messages: [],
		});
		await renderChat({
			server,
			pane: {
				id: swarmPaneId("ses_main"),
				kind: SWARM_PANE_KIND,
				title: "Swarm board",
				metadata: {},
				object: chatPaneObject("ses_main"),
				ordinal: 1,
			},
			chats: [chatSummary("ses_main", { createdAt: start })],
			boards: {
				ses_main: {
					ownerChatId: "ses_main",
					revision: 1,
					hasMore: false,
					messages: [
						{
							id: "post_early",
							timestamp: start,
							from: "main",
							to: "ALL",
							type: "INFO",
							body: "Starting the review.",
						},
						{
							id: "post_later",
							timestamp: start + 600_000,
							from: "main",
							to: "ALL",
							type: "RESULT",
							body: "Review complete.",
						},
					],
				},
			},
		});
		await page.getByTestId("swarm-timeline-toggle").click();
		const periods = page.getByTestId("swarm-run-toggle");
		await expect.poll(() => periods.all().length).toBe(2);
		expect(periods.first().element().textContent).toContain("Activity period 1");
		await expect
			.element(
				page.getByText(
					"Periods are inferred from quiet gaps of at least 2 minutes, not recorded agent turns.",
				),
			)
			.toBeVisible();
		await expect.element(periods.first()).toHaveAttribute("aria-expanded", "false");
		(periods.first().element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		await expect.element(periods.first()).toHaveAttribute("aria-expanded", "true");
		await expect.poll(() => page.getByTestId("swarm-timeline").all().length).toBe(2);
	});
});

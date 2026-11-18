import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { chatPaneObject } from "../../contracts";
import type { RecordedRequest } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const composerInput = () => page.getByTestId("kilo-composer-input");

async function send(text: string) {
	await userEvent.fill(composerInput(), text);
	await page.getByTestId("kilo-composer-send").click();
}

const promptText = (request: RecordedRequest) =>
	(request.body as { parts: { type: string; text?: string }[] }).parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");

describe("the New Session page's composer", () => {
	it("is origin's draft composer, focused, without a strip under it while it has nothing to say", async () => {
		await renderChat({ starter: {} });

		await expect.element(page.getByTestId("kilo-composer-send")).toBeDisabled();
		await expect.element(page.getByTestId("kilo-composer-draft-footer")).not.toBeVisible();
		await vi.waitFor(
			() => expect(document.activeElement?.closest(".aui-composer-root")).not.toBeNull(),
			{ timeout: 5_000 },
		);
	});

	it("takes focus from the button that asked for the page", async () => {
		const host = await renderChat({ starter: {} });
		await expect.element(composerInput()).toBeVisible();
		const newSession = document.createElement("button");
		newSession.textContent = "New session";
		document.body.append(newSession);
		try {
			newSession.focus();

			host.starter.requestFocus();

			await vi.waitFor(
				() => expect(document.activeElement?.closest(".aui-composer-root")).not.toBeNull(),
				{ timeout: 5_000 },
			);
		} finally {
			newSession.remove();
		}
	});

	it("tucks a draft-footer warning under the composer", async () => {
		await renderChat({ starter: {}, unavailableFolderIds: ["f-lib"] });

		const footer = page.getByTestId("kilo-composer-draft-footer");
		await expect.element(footer.getByTestId("kilo-composer-unavailable-folders")).toBeVisible();
		const composer = document.querySelector(".aui-composer-root")!.getBoundingClientRect();
		// Tucked: the strip starts under the composer's rounded bottom edge.
		expect(footer.element().getBoundingClientRect().top).toBeLessThan(composer.bottom);
	});

	it("starts the work session on the first send, with the chat and an Agent pane for it, then opens it", async () => {
		const host = await renderChat({ starter: {}, instructions: ["Prefer small diffs."] });
		expect(host.workSessions.calls.create).not.toHaveBeenCalled();

		await send("Fix the login form");

		await vi.waitFor(() => expect(host.starter.open).toHaveBeenCalledWith("wses_new_1"));
		expect(host.workSessions.calls.create).toHaveBeenCalledWith({ workspaceId: "w-app" });
		expect(host.workSessions.calls.createChat).toHaveBeenCalledWith(
			expect.objectContaining({ id: "wses_new_1", caller: "kilo.chat" }),
		);
		expect(host.agent.calls.create).toHaveBeenCalledWith(
			expect.objectContaining({
				workSessionId: "wses_new_1",
				directory: "/projects/app",
				workspaceId: "w-app",
			}),
		);
		expect(host.panesOf("wses_new_1")?.panes).toEqual([
			expect.objectContaining({ kind: "kilo.chat/agent", object: chatPaneObject("ses_new_1") }),
		]);
		const [prompt] = host.server.requestsTo("POST", "/session/ses_new_1/prompt_async");
		expect(promptText(prompt!)).toBe("Fix the login form");
		expect((prompt!.body as { system: string }).system).toContain("Prefer small diffs.");
	});

	it("works in the copy the work session was started in", async () => {
		const host = await renderChat({
			starter: { isolation: { kind: "new-copy", baseBranch: "main" } },
		});

		await send("Hi");

		await vi.waitFor(() => expect(host.starter.open).toHaveBeenCalled());
		expect(host.agent.calls.create).toHaveBeenCalledWith(
			expect.objectContaining({
				directory: "/projects/app/.kilo/worktrees/new",
				worktreeBranch: "kilo/new",
			}),
		);
		const [prompt] = host.server.requestsTo("POST", "/session/ses_new_1/prompt_async");
		expect(prompt!.directory).toBe("/projects/app/.kilo/worktrees/new");
		expect((prompt!.body as { system: string }).system).toContain(
			JSON.stringify("/projects/app/.kilo/worktrees/new"),
		);
	});

	it("discards the work session when its chat can't start, returning the message", async () => {
		const host = await renderChat({
			starter: {},
			createError: "The Kilo server isn't running.",
		});

		await send("Try this");

		await expect.element(page.getByText("Could not start the chat")).toBeVisible();
		await expect.element(composerInput()).toHaveTextContent("Try this");
		expect(host.workSessions.calls.remove).toHaveBeenCalledWith({
			id: "wses_new_1",
			removeCopy: true,
		});
		expect(host.starter.open).not.toHaveBeenCalled();
	});

	it("opens the work session when its first message fails, where the chat shows why", async () => {
		const host = await renderChat({ starter: {} });
		host.server.failPrompts = true;

		await send("Try this");

		await vi.waitFor(() => expect(host.starter.open).toHaveBeenCalledWith("wses_new_1"));
		expect(host.workSessions.calls.remove).not.toHaveBeenCalled();
	});

	it("starts nothing without Kilo's chats, keeping the message", async () => {
		const host = await renderChat({ starter: {}, withoutAgent: true });

		await send("Hello?");

		await expect.element(page.getByText("Could not start the chat").first()).toBeVisible();
		await expect.element(composerInput()).toHaveTextContent("Hello?");
		expect(host.workSessions.calls.create).not.toHaveBeenCalled();
	});

	it("still sends the first message when the page goes away while the work session starts", async () => {
		let finishWorktree!: () => void;
		const worktree = new Promise<void>((resolve) => (finishWorktree = resolve));
		const host = await renderChat({
			starter: { isolation: { kind: "new-copy", baseBranch: "main" }, holdStart: worktree },
		});

		await send("Fix the login form");
		await vi.waitFor(() => expect(host.starter.start).toHaveBeenCalled());
		// Another session opened: kilo.work-sessions unmounts the New Session page.
		host.view.unmount();
		finishWorktree();

		await vi.waitFor(
			() =>
				expect(host.server.requestsTo("POST", "/session/ses_new_1/prompt_async")).toHaveLength(1),
			{ timeout: 5_000 },
		);
		const [prompt] = host.server.requestsTo("POST", "/session/ses_new_1/prompt_async");
		expect(promptText(prompt!)).toBe("Fix the login form");
		expect(prompt!.directory).toBe("/projects/app/.kilo/worktrees/new");
		expect((prompt!.body as { system: string }).system).toContain(
			JSON.stringify("/projects/app/.kilo/worktrees/new"),
		);
		expect(host.starter.open).not.toHaveBeenCalled();
	});

	it("sends the first message once when the page closes after sending it", async () => {
		const host = await renderChat({ starter: {} });

		await send("Fix the login form");
		await vi.waitFor(() => expect(host.starter.open).toHaveBeenCalledWith("wses_new_1"));
		// Opening the work session closes the New Session page.
		host.view.unmount();
		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(host.server.requestsTo("POST", "/session/ses_new_1/prompt_async")).toHaveLength(1);
	});

	it("starts outside a workspace, in the chat's own folder", async () => {
		const host = await renderChat({ starter: {}, workspaceId: null, directory: null });

		await send("Scratch idea");

		await vi.waitFor(() => expect(host.starter.open).toHaveBeenCalledWith("wses_new_1"));
		expect(host.workSessions.calls.create).toHaveBeenCalledWith({ workspaceId: null });
	});
});

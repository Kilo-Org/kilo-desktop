import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { renderAgentPane } from "../../test/chat-host";
import type { RecordedRequest } from "../../test/fake-kilo-server";

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
	it("is origin's draft composer, focused, with where the session runs tucked under it", async () => {
		await renderAgentPane({
			starter: { footer: <span data-qa-id="test-footer">Local · main</span> },
		});

		const footer = page.getByTestId("kilo-composer-draft-footer");
		await expect.element(footer.getByTestId("test-footer")).toBeVisible();
		await expect.element(page.getByTestId("kilo-composer-send")).toBeDisabled();
		const composer = document.querySelector(".aui-composer-root")!.getBoundingClientRect();
		// Tucked: the footer starts under the composer's rounded bottom edge.
		expect(footer.element().getBoundingClientRect().top).toBeLessThan(composer.bottom);
		await vi.waitFor(
			() => expect(document.activeElement?.closest(".aui-composer-root")).not.toBeNull(),
			{ timeout: 5_000 },
		);
	});

	it("starts the session on the first send, with the chat and an Agent pane for it, then opens it", async () => {
		const host = await renderAgentPane({ starter: {}, instructions: ["Prefer small diffs."] });
		expect(host.sessions.calls.create).not.toHaveBeenCalled();

		await send("Fix the login form");

		await vi.waitFor(() => expect(host.starter.open).toHaveBeenCalledWith("wses_new_1"));
		expect(host.sessions.calls.create).toHaveBeenCalledWith({ workspaceId: "w-app" });
		expect(host.agent.calls.create).toHaveBeenCalledWith({
			sessionId: "wses_new_1",
			directory: "/projects/app",
			workspaceId: "w-app",
			workspaceFolders: [
				{ path: "/projects/app", isPrimary: true },
				{ path: "/projects/lib", isPrimary: false },
			],
		});
		expect(host.panesOf("wses_new_1")?.panes).toEqual([
			expect.objectContaining({ kind: "kilo.chat/agent", metadata: { chatId: "ses_new_1" } }),
		]);
		const [prompt] = host.server.requestsTo("POST", "/session/ses_new_1/prompt_async");
		expect(promptText(prompt!)).toBe("Fix the login form");
		expect((prompt!.body as { system: string }).system).toContain("Prefer small diffs.");
	});

	it("works in the worktree the session was started in", async () => {
		const host = await renderAgentPane({
			starter: { isolation: { kind: "new-worktree", baseBranch: "main" } },
		});

		await send("Hi");

		await vi.waitFor(() => expect(host.starter.open).toHaveBeenCalled());
		expect(host.agent.calls.create).toHaveBeenCalledWith(
			expect.objectContaining({
				directory: "/projects/app/.kilo/worktrees/new",
				worktreeBranch: "kilo/new",
				workspaceFolders: [
					{ path: "/projects/app/.kilo/worktrees/new", isPrimary: true },
					{ path: "/projects/lib", isPrimary: false },
				],
			}),
		);
		expect(host.server.requestsTo("POST", "/session/ses_new_1/prompt_async")[0]!.directory).toBe(
			"/projects/app/.kilo/worktrees/new",
		);
	});

	it("discards the session when its chat can't start, returning the message", async () => {
		const host = await renderAgentPane({
			starter: {},
			createError: "The Kilo server isn't running.",
		});

		await send("Try this");

		await expect.element(page.getByText("Could not start the chat")).toBeVisible();
		await expect.element(composerInput()).toHaveTextContent("Try this");
		expect(host.sessions.calls.remove).toHaveBeenCalledWith({
			id: "wses_new_1",
			removeWorktree: true,
		});
		expect(host.starter.open).not.toHaveBeenCalled();
	});
});

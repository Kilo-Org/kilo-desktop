import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { ReactNode } from "react";

import type { PluginEntry } from "@kilo-desktop/kernel";

import { chatPaneObject, ComposerAction } from "../../contracts";

import { agentPane, chatSummary, workSession } from "../../test/chat-host";
import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import { assistantMessage, session, text, userMessage } from "../../test/kilo2/fixtures";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const input = () => page.getByTestId("kilo-composer-input");

function serverWithChat(cost = 0) {
	const server = new FakeKilo2Server();
	server.addChat(session("ses_a", { title: "Fix login", cost }), [
		userMessage("Hello"),
		assistantMessage([text("Done.")], {
			cost,
			tokens: { input: 1_200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } },
		}),
	]);
	return server;
}

describe("attachments", () => {
	it("adds the files picked from the attach button", async () => {
		await renderChat();
		const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

		await page.getByTestId("kilo-composer-action-attach").click();
		const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
		expect(picker.multiple).toBe(true);
		expect(click).toHaveBeenCalled();
		const transfer = new DataTransfer();
		transfer.items.add(new File(["# Notes"], "notes.md", { type: "text/markdown" }));
		picker.files = transfer.files;
		picker.dispatchEvent(new Event("change"));

		await expect.element(page.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
		expect(document.querySelector('input[type="file"]')).toBeNull();
	});

	it("adds a file pasted into the input", async () => {
		await renderChat();
		await input().click();
		const transfer = new DataTransfer();
		transfer.items.add(new File(["png"], "shot.png", { type: "image/png" }));
		input()
			.element()
			.dispatchEvent(
				new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
			);

		await expect.element(page.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
	});
});

describe("the / menu", () => {
	it("lists Kilo's commands for the chat's folder and inserts the chosen one as a chip", async () => {
		const host = await renderChat();
		await input().click();
		await userEvent.keyboard("/rev");

		await page.getByText("Review the changes").click();
		await expect
			.element(page.getByLabelText("command: review", { exact: false }))
			.toBeInTheDocument();
		expect(
			host.server
				.requestsTo("GET", "/api/command")
				.map((request) => request.search.get("location[directory]")),
		).toContain("/projects/app");
	});
});

describe("Enter while the agent works", () => {
	it("queues the text, and on an empty composer sends the next queued prompt now", async () => {
		const server = serverWithChat();
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Done.")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.startTurn("ses_a");
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		await input().click();
		await userEvent.keyboard("Queued by Enter");
		await userEvent.keyboard("{Enter}");
		await expect
			.poll(() => page.getByTestId("kilo-composer-queue-toggle").element().textContent)
			.toContain("1 queued");
		expect(server.promptsTo("ses_a")).toHaveLength(0);

		// Sending now stops the running turn; the queued prompt follows once it has stopped.
		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() => expect(server.promptsTo("ses_a")).toHaveLength(1));
		expect(server.requestsTo("POST", "/api/session/ses_a/interrupt")).toHaveLength(1);
		expect(server.promptsTo("ses_a")[0]!.text).toBe("Queued by Enter");
	});
});

describe("the footer", () => {
	it("shows where a chat works and its context usage", async () => {
		const server = serverWithChat(0.42);
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});

		await expect.element(page.getByTestId("kilo-composer-session-mode")).toHaveTextContent("Local");
		await page.getByRole("button", { name: "Context usage" }).click();
		await expect.element(page.getByTestId("kilo-composer-context-popover")).toBeVisible();
	});

	it("sits below the composer, leaving its bottom edge uncovered", async () => {
		await renderChat({
			server: serverWithChat(0.42),
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByTestId("kilo-composer-session-mode")).toBeVisible();

		const composer = document.querySelector(".aui-composer-root")!.getBoundingClientRect();
		const footer = page.getByTestId("kilo-composer-footer").element().getBoundingClientRect();
		// The footer's backdrop reaches 6px (`-top-1.5`) above it: that must stay in the gap.
		expect(footer.top - composer.bottom).toBeGreaterThanOrEqual(6);
	});

	it("names a worktree chat's worktree", async () => {
		const server = new FakeKilo2Server();
		server.addChat(session("ses_a", { directory: "/worktrees/fix-login", title: "Fix login" }), [
			userMessage("Hello"),
		]);
		await renderChat({
			server,
			directory: "/worktrees/fix-login",
			workSession: workSession({ directory: "/worktrees/fix-login", branch: "fix-login" }),
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a", { directory: "/worktrees/fix-login" })],
		});

		await expect
			.element(page.getByTestId("kilo-composer-session-mode"))
			.toHaveTextContent("fix-login");
	});
});

describe("a new chat's footer", () => {
	it("says where it will work before its first message, without usage yet", async () => {
		await renderChat({
			directory: "/worktrees/fix-login",
			workSession: workSession({ directory: "/worktrees/fix-login", branch: "fix-login" }),
		});

		const footer = page.getByTestId("kilo-composer-footer");
		await expect
			.element(footer.getByTestId("kilo-composer-session-mode"))
			.toHaveTextContent("fix-login");
		await expect.element(footer.getByTestId("kilo-composer-footer-cost")).not.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: "Context usage" }))
			.not.toBeInTheDocument();
	});

	it("shows the footer composer actions, such as the branch", async () => {
		await renderChat({
			plugins: [footerContributor(() => <span data-qa-id="test-branch">main</span>)],
		});

		await expect
			.element(page.getByTestId("kilo-composer-footer").getByTestId("test-branch"))
			.toHaveTextContent("main");
	});
});

describe("unavailable workspace folders", () => {
	const warning = () => page.getByTestId("kilo-composer-unavailable-folders");

	it("warns under a chat's composer and opens the workspace's settings", async () => {
		const host = await renderChat({
			server: serverWithChat(),
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
			unavailableFolderIds: ["f-lib"],
		});

		await expect.element(warning()).toHaveAccessibleName("App has unavailable folders");
		await warning().click();
		expect(host.workspaceEdited).toHaveBeenCalledWith({ workspaceId: "w-app" });
	});

	it("warns under a new chat's composer", async () => {
		await renderChat({ unavailableFolderIds: ["f-lib"] });

		await expect
			.element(
				page.getByTestId("kilo-composer-footer").getByTestId("kilo-composer-unavailable-folders"),
			)
			.toBeVisible();
	});

	it("stays out of the way while every folder is there", async () => {
		await renderChat();
		await expect.element(input()).toBeVisible();

		await expect.element(warning()).not.toBeInTheDocument();
	});

	it("says nothing for a chat outside any workspace", async () => {
		await renderChat({ workspaceId: null, unavailableFolderIds: ["f-lib"] });
		await expect.element(input()).toBeVisible();

		await expect.element(warning()).not.toBeInTheDocument();
	});
});

/** A plugin putting `view` in the composer's footer slot. */
function footerContributor(view: () => ReactNode) {
	return {
		manifest: {
			manifestVersion: 1,
			id: "test.footer",
			displayName: "Footer",
			version: "1.0.0",
			contributes: {
				extensions: {
					"kilo.chat/composer-action": [
						{ id: "branch", slot: "footer", kind: "view", title: "Branch" },
					],
				},
			},
		},
		web: {
			activate(sdk) {
				sdk.extensions.implement(ComposerAction, "branch", { kind: "view", Component: view });
			},
		} satisfies PluginEntry,
	};
}

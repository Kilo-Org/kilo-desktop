import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { definePlugin, type PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";

import { SavedSource, type SavedItem, type SavedSourceImplementation } from "../../contracts";
import {
	grantDataCollection,
	renderWorkSessions,
	telemetrySink,
	workSession as session,
	workspace,
} from "../../testing";

const HOUR = 60 * 60_000;

function item(id: string, patch: Partial<SavedItem>): SavedItem {
	return {
		id,
		source: "test.chat/chat-text",
		workSessionId: "a",
		ref: { type: "kilo.core/chat", id: "ses_1" },
		title: "Login chat",
		text: "",
		anchor: "{}",
		createdAt: Date.now() - HOUR,
		...patch,
	};
}

const ITEMS: SavedItem[] = [
	item("s1", { text: "Redirect after sign-in goes to /home", createdAt: Date.now() - 1_000 }),
	item("s2", { source: "test.chat/chat-bookmark", title: "Login chat" }),
	item("s3", { workSessionId: "b", text: "Signup needs a captcha", title: "Signup chat" }),
];

/** A plugin that saves chat items, recording what the Saved page asks it to reveal. */
function chatSource(reveal: SavedSourceImplementation["reveal"]) {
	return {
		manifest: testManifest("test.chat", {
			contributes: {
				extensions: {
					"kilo.work-sessions/saved-source": [
						{ id: "chat-text", label: "Saved text", presentation: "quote", filter: "text" },
						{
							id: "chat-bookmark",
							label: "Bookmarked chat",
							presentation: "bookmark",
							filter: "chats",
						},
					],
				},
			},
		}),
		web: definePlugin({
			activate(sdk: PluginSdk) {
				sdk.extensions.implement(SavedSource, "chat-text", { reveal });
				sdk.extensions.implement(SavedSource, "chat-bookmark", { reveal });
			},
		}),
	};
}

async function showSaved(reveal: SavedSourceImplementation["reveal"] = async () => "exact") {
	const sink = telemetrySink();
	const rendered = await renderWorkSessions({
		workSessions: [
			session("a", { title: "Fix login redirect", workspaceId: "w1" }),
			session("b", { title: "Add signup", workspaceId: "w2" }),
		],
		workspaces: [workspace("w1", "acme-app"), workspace("w2", "acme-web")],
		saved: ITEMS,
		guests: [chatSource(reveal), sink.plugin],
		beforeRender: grantDataCollection,
		open: "a",
	});
	await page.getByTestId("session-list-saved").click();
	await expect.element(page.getByTestId("saved-view")).toBeVisible();
	return { ...rendered, sink };
}

describe("the Saved page", () => {
	it("opens from the sidebar's Saved item, which counts every saved item", async () => {
		const { sink } = await showSaved();

		await expect.element(page.getByTestId("session-list-saved-count")).toHaveTextContent("3");
		await expect.element(page.getByRole("heading", { name: "Saved" })).toBeVisible();
		await expect
			.element(page.getByText("Chats you’ve bookmarked and text you’ve saved, from every session."))
			.toBeVisible();
		await expect.element(page.getByTestId("sessions-view-title")).toHaveTextContent("Saved");
		expect(page.getByTestId("sessions-view-title").getByText("acme-app").elements()).toHaveLength(
			0,
		);
		expect(sink.events("saved-page-opened")).toEqual([
			{ source: "sidebar", itemCount: "2-5", sessionCount: "2-5" },
		]);
	});

	it("groups items by session, this session first, with each kind of row", async () => {
		await showSaved();

		const groups = page.getByTestId("saved-group");
		await expect.element(groups.first()).toHaveAccessibleName("Fix login redirect · acme-app");
		await expect
			.element(groups.first().getByTestId("saved-this-session"))
			.toHaveTextContent("This session");
		await expect.element(groups.nth(1)).toHaveAccessibleName("Add signup · acme-web");
		const rows = groups.first().getByTestId("saved-row");
		await expect
			.element(rows.first())
			.toHaveTextContent("Redirect after sign-in goes to /homeLogin chat · just now");
		await expect.element(rows.nth(1)).toHaveTextContent("Login chatBookmarked chat · 1 hour ago");
	});

	it("searches and filters by kind, with counts", async () => {
		await showSaved();

		await expect.element(page.getByTestId("saved-filter-chats")).toHaveTextContent("Chats1");
		await expect.element(page.getByTestId("saved-filter-text")).toHaveTextContent("Text2");
		await page.getByTestId("saved-filter-chats").click();
		await expect.poll(() => page.getByTestId("saved-row").elements().length).toBe(1);

		await page.getByTestId("saved-filter-all").click();
		await page.getByTestId("saved-search").fill("captcha");
		await expect.poll(() => page.getByTestId("saved-row").elements().length).toBe(1);
		await expect
			.element(page.getByTestId("saved-row"))
			.toHaveTextContent("Signup needs a captchaSignup chat · 1 hour ago");

		await page.getByTestId("saved-search").fill("nothing like this");
		await expect.element(page.getByTestId("saved-no-matches")).toBeVisible();
	});

	it("asks the item's source to open it, and says so when it can't be found", async () => {
		const reveal = vi.fn<SavedSourceImplementation["reveal"]>(async (saved) =>
			saved.id === "s1" ? "exact" : "unavailable",
		);
		const { sink } = await showSaved(reveal);

		await page.getByText("Redirect after sign-in goes to /home").click();
		await page.getByText("Signup needs a captcha").click();

		expect(reveal.mock.calls.map(([saved]) => saved.id)).toEqual(["s1", "s3"]);
		await expect.element(page.getByText("Couldn't find where this was saved")).toBeVisible();
		await expect
			.poll(() => sink.events("saved-item-opened").map((data) => data.resolved))
			.toEqual(["exact", "unavailable"]);
	});

	it("removes a row, and Undo puts it back", async () => {
		const { main } = await showSaved();
		const row = page.getByTestId("saved-row").first();

		await row.hover();
		await row.getByRole("button", { name: "Remove from Saved" }).click();

		await expect.poll(() => main.saved().state.items.map(({ id }) => id)).toEqual(["s2", "s3"]);
		await page.getByRole("button", { name: "Undo" }).click();
		await expect
			.poll(() => main.saved().state.items.map(({ id }) => id))
			.toEqual(["s1", "s2", "s3"]);
	});
});

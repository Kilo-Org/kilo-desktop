import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { DEFAULT_WORK_SESSION_TITLE } from "../../contracts";
import { renderWorkSessions, workSession, workspace } from "../../testing";

const row = (title: string) =>
	page
		.getByTestId("kilo-thread-list")
		.getByTestId(/^session-list-(archived-)?item$/)
		.filter({ hasText: title });

describe("the New Session page and its commands", () => {
	it("starts a session in the active workspace and opens it", async () => {
		const { workSessions, window, run } = await renderWorkSessions({
			workspaces: [workspace("w-app", "App")],
			activeWorkspaceId: "w-app",
		});

		await expect
			.element(page.getByTestId("launcher-headline"))
			.toHaveTextContent("What should we work on in App?");
		await run("new-empty-work-session");

		await vi.waitFor(() =>
			expect(workSessions.calls.create).toHaveBeenCalledWith({ workspaceId: "w-app" }),
		);
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("wses_1"));
		await expect.element(row(DEFAULT_WORK_SESSION_TITLE)).toBeVisible();
	});

	it("reports a session that could not be started", async () => {
		const { workSessions, run } = await renderWorkSessions();
		workSessions.failNextWith("Disk full.");
		await expect.element(page.getByTestId("workbench-launcher")).toBeVisible();

		await run("new-empty-work-session");

		await expect.element(page.getByText("Disk full.")).toBeVisible();
	});

	it("New session returns to the launcher in the open session's workspace", async () => {
		const { run, window, workspaces } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login", workspaceId: "w-docs" })],
			workspaces: [workspace("w-app", "App"), workspace("w-docs", "Docs")],
			activeWorkspaceId: "w-app",
		});
		await row("Fix login").getByTestId("session-list-item-trigger").click();

		await run("new-work-session");

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBeNull());
		expect(workspaces.setActive).toHaveBeenCalledWith("w-docs");
		await expect
			.element(page.getByTestId("launcher-headline"))
			.toHaveTextContent("What should we work on in Docs?");
	});

	it("New session keeps the workspace picked in the switcher over the open session's", async () => {
		const { run, window } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login", workspaceId: "w-app" })],
			workspaces: [workspace("w-app", "App"), workspace("w-docs", "Docs")],
			activeWorkspaceId: "w-app",
		});
		await row("Fix login").getByTestId("session-list-item-trigger").click();
		await page.getByTestId("session-list-workspace-filter").click();
		await page.getByRole("option", { name: /Docs/ }).click();
		await vi.waitFor(() => expect(window().getState().focus).toBe("w-docs"));

		await run("new-work-session");

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBeNull());
		await expect
			.element(page.getByTestId("launcher-headline"))
			.toHaveTextContent("What should we work on in Docs?");
	});

	it("the New session entry opens the launcher too", async () => {
		const { window } = await renderWorkSessions({ workSessions: [workSession("a")] });
		await row("Session a").getByTestId("session-list-item-trigger").click();

		await page.getByTestId("new-chat").click();

		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBeNull());
	});

	it("searches sessions and workspaces", async () => {
		const { run, window } = await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "Fix login" }),
				workSession("b", { title: "Old login idea", archived: true }),
				workSession("c", { title: "Write docs" }),
			],
			workspaces: [workspace("w-app", "App")],
		});

		await run("search-work-sessions");
		await page.getByTestId("session-search-input").fill("login");
		await expect.element(page.getByTestId("session-search-session-b")).toBeVisible();
		await expect.element(page.getByTestId("session-search-session-c")).not.toBeInTheDocument();
		await page.getByTestId("session-search-session-a").click();
		await vi.waitFor(() => expect(window().getState().activeWorkSessionId).toBe("a"));

		await page.getByTestId("session-list-search").click();
		await page.getByTestId("session-search-filter-workspaces").click();
		await page.getByTestId("session-search-workspace-w-app").click();
		await vi.waitFor(() => expect(window().getState().focus).toBe("w-app"));
	});

	it("pins and unpins the open session", async () => {
		const { run, window, workSessions } = await renderWorkSessions({
			workSessions: [workSession("a", { title: "Fix login" })],
		});
		await window().methods.openWorkSession({ workSessionId: "a" });

		await run("toggle-pin-work-session");
		await vi.waitFor(() => expect(workSessions.calls.setPinned).toHaveBeenCalledWith("a", true));
		await run("toggle-pin-work-session");
		await vi.waitFor(() =>
			expect(workSessions.calls.setPinned).toHaveBeenLastCalledWith("a", false),
		);
	});
});

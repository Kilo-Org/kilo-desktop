import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { OpenCodePermissionRequest } from "@assistant-ui/react-opencode";

const runtime = vi.hoisted(() => ({
	pending: [] as OpenCodePermissionRequest[],
	replyToPermission: vi.fn(async () => undefined),
}));

vi.mock("@assistant-ui/react-opencode", () => ({
	useOpenCodePermissions: () => ({ pending: runtime.pending, reply: runtime.replyToPermission }),
	useOpenCodeRuntimeExtras: () => ({ replyToPermission: runtime.replyToPermission }),
	useOpenCodeThreadState: vi.fn(),
}));

import { OpenCodeUnlinkedPermissionCards } from "./opencode-tool-interactions.js";

const permission = (
	id: string,
	title: string,
	tool?: OpenCodePermissionRequest["tool"],
): OpenCodePermissionRequest => ({
	id,
	sessionId: "session-1",
	permission: "bash",
	patterns: [],
	metadata: {},
	always: [],
	tool,
	toolName: "bash",
	title,
	askedAt: 1,
	raw: {} as OpenCodePermissionRequest["raw"],
});

afterEach(() => {
	cleanup();
	runtime.pending.length = 0;
	runtime.replyToPermission.mockClear();
});

describe("OpenCodeUnlinkedPermissionCards", () => {
	it("renders and replies to permissions that have no tool call", async () => {
		runtime.pending.push(
			permission("unlinked", "Unlinked permission"),
			permission("linked", "Linked permission", {
				messageID: "message-1",
				callID: "call-1",
			}),
		);
		const { baseElement } = render(<OpenCodeUnlinkedPermissionCards />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Unlinked permission")).toBeVisible();
		await expect.element(screen.getByText("Linked permission")).not.toBeInTheDocument();

		await screen.getByRole("button", { name: "Allow once" }).click();
		await expect.poll(() => runtime.replyToPermission.mock.calls).toEqual([["unlinked", "once"]]);
	});
});

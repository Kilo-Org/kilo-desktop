import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { OpenCodePermissionRequest } from "@assistant-ui/react-opencode";

// The permission event carries no args; the card resolves them from the thread.
const threadState = vi.hoisted(() => ({ messages: [] as unknown[] }));

vi.mock("@assistant-ui/react", () => ({
	useAuiState: (selector: (state: { thread: { messages: unknown[] } }) => unknown) =>
		selector({ thread: threadState }),
}));

vi.mock("@assistant-ui/react-opencode", () => ({
	useOpenCodeRuntimeExtras: () => ({ replyToPermission: vi.fn() }),
}));

import { OpenCodePermissionCard } from "./opencode-permission-card.js";
import { LOCAL_CONDA_FILE_INSTALL_WARNING } from "./conda-local-file-warning.js";

afterEach(cleanup);
beforeEach(() => {
	threadState.messages = [];
});

function permissionRequest(
	overrides: Partial<OpenCodePermissionRequest>,
): OpenCodePermissionRequest {
	return {
		id: "request-1",
		sessionId: "session-1",
		permission: "desktop_environments_conda_envs_delete",
		patterns: ["*"],
		metadata: {},
		// A non-empty `always` means Kilo has a rule it could remember, so the
		// "Always allow" button is offered unless another condition hides it.
		always: ["*"],
		askedAt: 0,
		raw: {} as never,
		...overrides,
	} as OpenCodePermissionRequest;
}

function threadWithToolArgs(callID: string, args: unknown): void {
	threadState.messages = [
		{ id: "message-1", content: [{ type: "tool-call", toolCallId: callID, args }] },
	];
}

describe("OpenCodePermissionCard", () => {
	it("shows a friendly title and keeps the raw tool name", async () => {
		const { baseElement } = render(<OpenCodePermissionCard request={permissionRequest({})} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Allow deleting a conda environment?")).toBeVisible();
		await expect.element(screen.getByText("desktop_environments_conda_envs_delete")).toBeVisible();
	});

	it("hides the bare wildcard pattern", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard request={permissionRequest({ patterns: ["*"] })} />,
		);

		expect(baseElement.textContent).not.toContain("*");
	});

	it("still shows a meaningful pattern", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "external_directory",
					patterns: ["/workspace/notes.ipynb"],
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("/workspace/notes.ipynb")).toBeVisible();
	});

	it("falls back to the raw name when the tool has no friendly label", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({ permission: "desktop_some_unknown_tool" })}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Allow desktop_some_unknown_tool?")).toBeVisible();
	});

	it("summarises the requested environment, packages, and channels", async () => {
		threadWithToolArgs("call-1", { name: "analysis", packages: ["numpy", "pandas"] });
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "desktop_environments_conda_packages_install",
					tool: { messageID: "message-1", callID: "call-1" },
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("analysis")).toBeVisible();
		await expect.element(screen.getByText("numpy, pandas")).toBeVisible();
	});

	it("says channels are unspecified (not a trusted label) when the agent gave none", async () => {
		threadWithToolArgs("call-4", { name: "test-456", packages: ["python=3.13", "pandas"] });
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "desktop_environments_conda_envs_create",
					tool: { messageID: "message-1", callID: "call-4" },
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByText("not specified (uses your configured channels)"))
			.toBeVisible();
	});

	it("warns about unknown channels", async () => {
		threadWithToolArgs("call-2", { name: "e", channels: ["main", "https://evil.example/conda"] });
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "desktop_environments_conda_envs_create",
					tool: { messageID: "message-1", callID: "call-2" },
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByText("Unknown channel: https://evil.example/conda"))
			.toBeVisible();
	});

	it("warns that delete removes the whole environment", async () => {
		threadWithToolArgs("call-3", { name: "e" });
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					tool: { messageID: "message-1", callID: "call-3" },
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(
				screen.getByText(
					"Removes the entire environment and all of its packages. This is irreversible — review carefully before allowing.",
				),
			)
			.toBeVisible();
	});

	it("surfaces a URL package spec as a non-default source", async () => {
		threadWithToolArgs("call-6", { name: "e", packages: ["https://evil.example/pkg-1.0-0.conda"] });
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "desktop_environments_conda_packages_install",
					tool: { messageID: "message-1", callID: "call-6" },
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByText("Non-default package source: https://evil.example/pkg-1.0-0.conda"))
			.toBeVisible();
	});

	it("does not offer a standing allow for a non-default source", async () => {
		threadWithToolArgs("call-7", { name: "e", packages: ["https://evil.example/pkg"] });
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "desktop_environments_conda_packages_install",
					tool: { messageID: "message-1", callID: "call-7" },
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByText("Non-default package source: https://evil.example/pkg"))
			.toBeVisible();
		expect(baseElement.textContent).not.toContain("Always allow");
	});

	it("does not offer a standing allow for a mutating conda tool, even from a default source", async () => {
		threadWithToolArgs("call-8", { name: "e", packages: ["numpy"] });
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "desktop_environments_conda_packages_install",
					tool: { messageID: "message-1", callID: "call-8" },
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("numpy")).toBeVisible();
		expect(baseElement.textContent).not.toContain("Always allow");
	});

	it("still offers a standing allow for a non-conda tool", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({ permission: "bash", patterns: ["rm -rf /tmp/x"] })}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("button", { name: "Always allow" })).toBeVisible();
	});

	it("hides the standing allow when Kilo has no matching rule to remember", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({ permission: "bash", patterns: ["ls"], always: [] })}
			/>,
		);

		expect(baseElement.textContent).not.toContain("Always allow");
	});

	it("hides the standing allow for a conda CLI command run via bash", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({ permission: "bash", patterns: ["conda install numpy"] })}
			/>,
		);

		expect(baseElement.textContent).not.toContain("Always allow");
	});

	it("hides the standing allow on a local-file install guardrail bypass", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "bash",
					patterns: ["conda install /Users/me/Downloads/pandas-3.0.6-py314heb7d0cc_0.tar.bz2"],
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(LOCAL_CONDA_FILE_INSTALL_WARNING)).toBeVisible();
		expect(baseElement.textContent).not.toContain("Always allow");
	});

	it("warns that a bash install of a local conda file bypasses the guardrail", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "bash",
					patterns: [
						"conda install -p /Users/me/envs/dev /Users/me/Downloads/pandas-3.0.6-py314heb7d0cc_0.tar.bz2",
					],
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(LOCAL_CONDA_FILE_INSTALL_WARNING)).toBeVisible();
	});

	it("does not warn for an ordinary bash channel install", async () => {
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({ permission: "bash", patterns: ["conda install numpy"] })}
			/>,
		);

		expect(baseElement.textContent).not.toContain("bypasses the Desktop security guardrail");
	});

	it("warns when an update targets every package", async () => {
		threadWithToolArgs("call-5", { name: "e", updateAll: true });
		const { baseElement } = render(
			<OpenCodePermissionCard
				request={permissionRequest({
					permission: "desktop_environments_conda_packages_update",
					tool: { messageID: "message-1", callID: "call-5" },
				})}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByText("Updates all packages in the environment; this can break it."))
			.toBeVisible();
	});
});

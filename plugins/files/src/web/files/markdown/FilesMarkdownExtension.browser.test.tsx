import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { MarkdownAnchor, MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";

import { filesContract } from "../../../contracts/schemas.js";
import { FilesMarkdownExtension } from "./FilesMarkdownExtension.js";

afterEach(cleanup);

describe("FilesMarkdownExtension", () => {
	it("renders a compact file chip that opens the Files panel", async () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openFile = vi.fn();
		filesSdk.plugins.expose("fileViewer", { openFile });
		const context = {
			sessionId: "session-1",
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		};
		const extension = FilesMarkdownExtension(context);
		const decorateComponents = extension.decorateComponents;
		if (!decorateComponents) throw new Error("Expected a component decorator");
		const components = decorateComponents({ a: MarkdownAnchor });
		const FileAnchor = components.a;
		if (typeof FileAnchor !== "function") throw new Error("Expected an anchor component");

		render(
			<SdkProvider system={system}>
				{createElement(FileAnchor, {
					href: "apps/desktop/AGENTS.md#L42C7",
					children: "apps/desktop/AGENTS.md",
					"data-file-parent-suffix": "apps/desktop",
				} as ComponentProps<"a">)}
			</SdkProvider>,
		);

		const chip = page.getByTestId("markdown-file-link");
		await expect.element(chip).toHaveTextContent("AGENTS.md · apps/desktop · L42:C7");
		expect(chip.element().querySelector("[data-pierre-file-icon]")).not.toBeNull();

		await chip.click();
		expect(openFile).toHaveBeenCalledWith({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project",
			relativePath: "apps/desktop/AGENTS.md",
			line: 42,
			column: 7,
		});
	});

	it("renders qualifying inline-code paths as file chips", async () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openFile = vi.fn();
		filesSdk.plugins.expose("fileViewer", { openFile });
		const extension = FilesMarkdownExtension({
			sessionId: "session-1",
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		});

		render(
			<SdkProvider system={system}>
				<MarkdownContent text="`notebooks/analysis.ipynb`" extensions={[extension]} />
			</SdkProvider>,
		);

		const chip = page.getByTestId("markdown-file-link");
		await expect.element(chip).toHaveTextContent("analysis.ipynb");
		await chip.click();
		expect(openFile).toHaveBeenCalledWith({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project",
			relativePath: "notebooks/analysis.ipynb",
		});
	});

	it("renders a bare inline filename when it exists in the workspace", async () => {
		const existingPaths = vi.fn(async () => ({ paths: ["README.md"] }));
		const filesSdk = createFakeSdk({
			featureId: "files",
			channels: filesContract,
			handlers: { existingPaths },
		});
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openFile = vi.fn();
		filesSdk.plugins.expose("fileViewer", { openFile });
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const extension = FilesMarkdownExtension({
			sessionId: "session-1",
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		});
		const decorateComponents = extension.decorateComponents;
		if (!decorateComponents) throw new Error("Expected a component decorator");
		const FileCode = decorateComponents({}).code;
		if (typeof FileCode !== "function") throw new Error("Expected a code component");
		const inlineCodeNode = (value: string) => ({
			type: "element" as const,
			tagName: "code",
			properties: { "data-inline-code": "" },
			children: [{ type: "text" as const, value }],
		});

		render(
			<QueryClientProvider client={queryClient}>
				<SdkProvider system={system}>
					{createElement(FileCode, {
						children: "README.md",
						node: inlineCodeNode("README.md"),
					})}
					{" and "}
					{createElement(FileCode, {
						children: "node.meta",
						node: inlineCodeNode("node.meta"),
					})}
				</SdkProvider>
			</QueryClientProvider>,
		);

		const chip = page.getByTestId("markdown-file-link");
		await expect.element(chip).toHaveTextContent("README.md");
		expect(
			[...document.querySelectorAll("code")].some((element) => element.textContent === "node.meta"),
		).toBe(true);
		expect(existingPaths).toHaveBeenCalledTimes(1);
		expect(existingPaths).toHaveBeenCalledWith({
			workspaceDirectory: "/workspace/project",
			relativePaths: ["README.md", "node.meta"],
		});
	});

	it("renders plain paths as file chips only when they exist in the workspace", async () => {
		const list = vi.fn(async () => ({
			paths: ["AGENTS.md", "docs/", "docs/TESTING.md"],
			truncated: false,
		}));
		const existingPaths = vi.fn(async () => ({
			paths: ["AGENTS.md", "docs/TESTING.md"],
		}));
		const filesSdk = createFakeSdk({
			featureId: "files",
			channels: filesContract,
			handlers: { existingPaths, list },
		});
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openFile = vi.fn();
		filesSdk.plugins.expose("fileViewer", { openFile });
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const extension = FilesMarkdownExtension({
			sessionId: "session-1",
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		});

		const { container } = render(
			<QueryClientProvider client={queryClient}>
				<SdkProvider system={system}>
					<MarkdownContent
						text={"- AGENTS.md\n- docs/TESTING.md\n- docs/missing.md"}
						extensions={[extension]}
					/>
				</SdkProvider>
			</QueryClientProvider>,
		);

		await expect
			.poll(() => container.querySelectorAll('[data-qa-id="markdown-file-link"]').length)
			.toBe(2);
		expect(
			[...container.querySelectorAll('[data-qa-id="markdown-file-link"]')].map((chip) =>
				chip.getAttribute("title"),
			),
		).toEqual(["AGENTS.md", "docs/TESTING.md"]);
		expect(container.querySelector('a[title="docs/missing.md"]')).toBeNull();
		expect(container.textContent).toContain("docs/missing.md");
		(container.querySelector('a[title="docs/TESTING.md"]') as HTMLAnchorElement).click();
		expect(openFile).toHaveBeenCalledWith({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project",
			relativePath: "docs/TESTING.md",
		});
		expect(existingPaths).toHaveBeenCalledTimes(1);
		expect(existingPaths).toHaveBeenCalledWith({
			workspaceDirectory: "/workspace/project",
			relativePaths: ["AGENTS.md", "docs/TESTING.md", "docs/missing.md"],
		});
		expect(list).not.toHaveBeenCalled();
	});
});

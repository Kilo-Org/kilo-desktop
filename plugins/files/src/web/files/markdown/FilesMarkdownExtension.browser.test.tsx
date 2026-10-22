import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { MarkdownAnchor, MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";

import { filesContract, type FileLinkResolution } from "../../../contracts/schemas.js";
import { FilesMarkdownExtension } from "./FilesMarkdownExtension.js";

const toastError = vi.hoisted(() => vi.fn());

vi.mock("@kilo-desktop/ui/components/sonner", () => ({ toast: { error: toastError } }));

afterEach(() => {
	cleanup();
	toastError.mockClear();
});

const exactAt = (relativePath: string): FileLinkResolution => ({
	kind: "exact",
	paths: [relativePath],
	truncated: false,
});

function createFilesSdk(resolveFileLink: (input: { relativePath: string }) => FileLinkResolution) {
	return createFakeSdk({
		featureId: "files",
		channels: filesContract,
		handlers: {
			resolveFileLink: async ({ relativePath }: { relativePath: string }) =>
				resolveFileLink({ relativePath }),
			existingPaths: async () => ({ paths: [] }),
		},
	});
}

function queryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("FilesMarkdownExtension", () => {
	it("renders a compact file chip that opens the Files panel", async () => {
		const filesSdk = createFilesSdk(({ relativePath }) => exactAt(relativePath));
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
			<QueryClientProvider client={queryClient()}>
				<SdkProvider system={system}>
					{createElement(FileAnchor, {
						href: "apps/desktop/AGENTS.md#L42C7",
						children: "apps/desktop/AGENTS.md",
						"data-file-parent-suffix": "apps/desktop",
					} as ComponentProps<"a">)}
				</SdkProvider>
			</QueryClientProvider>,
		);

		const chip = page.getByTestId("markdown-file-link");
		await expect.element(chip).toHaveTextContent("AGENTS.md · apps/desktop · L42:C7");
		expect(chip.element().querySelector("[data-pierre-file-icon]")).not.toBeNull();

		await chip.click();
		await expect.poll(() => openFile.mock.calls.length).toBe(1);
		expect(openFile).toHaveBeenCalledWith({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project",
			relativePath: "apps/desktop/AGENTS.md",
			line: 42,
			column: 7,
		});
	});

	it("renders qualifying inline-code paths as file chips without a root existence check", async () => {
		const existingPaths = vi.fn(async () => ({ paths: [] }));
		const filesSdk = createFakeSdk({
			featureId: "files",
			channels: filesContract,
			handlers: {
				existingPaths,
				resolveFileLink: async ({ relativePath }: { relativePath: string }) =>
					exactAt(relativePath),
			},
		});
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openFile = vi.fn();
		filesSdk.plugins.expose("fileViewer", { openFile });
		const extension = FilesMarkdownExtension({
			sessionId: "session-1",
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		});

		render(
			<QueryClientProvider client={queryClient()}>
				<SdkProvider system={system}>
					<MarkdownContent text="`notebooks/analysis.ipynb`" extensions={[extension]} />
				</SdkProvider>
			</QueryClientProvider>,
		);

		const chip = page.getByTestId("markdown-file-link");
		await expect.element(chip).toHaveTextContent("analysis.ipynb");
		await chip.click();
		await expect.poll(() => openFile.mock.calls.length).toBe(1);
		expect(openFile).toHaveBeenCalledWith({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project",
			relativePath: "notebooks/analysis.ipynb",
		});
		expect(existingPaths).not.toHaveBeenCalled();
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
		const client = queryClient();
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
			<QueryClientProvider client={client}>
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
			handlers: {
				existingPaths,
				list,
				resolveFileLink: async ({ relativePath }: { relativePath: string }) =>
					exactAt(relativePath),
			},
		});
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openFile = vi.fn();
		filesSdk.plugins.expose("fileViewer", { openFile });
		const extension = FilesMarkdownExtension({
			sessionId: "session-1",
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		});

		const { container } = render(
			<QueryClientProvider client={queryClient()}>
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
		await expect.poll(() => openFile.mock.calls.length).toBe(1);
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

	describe("clicking an unresolved link", () => {
		function renderSubfolderLink(resolution: FileLinkResolution) {
			const resolveFileLink = vi.fn(async () => resolution);
			const filesSdk = createFakeSdk({
				featureId: "files",
				channels: filesContract,
				handlers: { resolveFileLink },
			});
			const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
			const openFile = vi.fn();
			filesSdk.plugins.expose("fileViewer", { openFile });
			const extension = FilesMarkdownExtension({
				sessionId: "session-1",
				workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
			});

			render(
				<QueryClientProvider client={queryClient()}>
					<SdkProvider system={system}>
						<MarkdownContent text={"`src/kilo-plugin/index.ts`"} extensions={[extension]} />
					</SdkProvider>
				</QueryClientProvider>,
			);
			return { openFile, resolveFileLink };
		}

		it("opens the single suffix match", async () => {
			const { openFile, resolveFileLink } = renderSubfolderLink({
				kind: "matches",
				paths: ["plugins/notebook/src/kilo-plugin/index.ts"],
				truncated: false,
			});

			await page.getByTestId("markdown-file-link").click();

			await expect.poll(() => openFile.mock.calls.length).toBe(1);
			expect(resolveFileLink).toHaveBeenCalledWith({
				workspaceDirectory: "/workspace/project",
				relativePath: "src/kilo-plugin/index.ts",
			});
			expect(openFile).toHaveBeenCalledWith({
				sessionId: "session-1",
				workspaceDirectory: "/workspace/project",
				relativePath: "plugins/notebook/src/kilo-plugin/index.ts",
			});
		});

		it("offers a picker for several matches and opens only the chosen file", async () => {
			const { openFile } = renderSubfolderLink({
				kind: "matches",
				paths: ["a/src/kilo-plugin/index.ts", "b/src/kilo-plugin/index.ts"],
				truncated: false,
			});

			await page.getByTestId("markdown-file-link").click();
			await page.getByTestId("file-link-candidate-b/src/kilo-plugin/index.ts").click();

			await expect.poll(() => openFile.mock.calls.length).toBe(1);
			expect(openFile).toHaveBeenCalledWith({
				sessionId: "session-1",
				workspaceDirectory: "/workspace/project",
				relativePath: "b/src/kilo-plugin/index.ts",
			});
		});

		it("reports a missing file and does not open the Files pane", async () => {
			const { openFile } = renderSubfolderLink({ kind: "none", paths: [], truncated: false });

			await page.getByTestId("markdown-file-link").click();

			await expect.poll(() => toastError.mock.calls.length).toBe(1);
			expect(toastError).toHaveBeenCalledWith("File not found: src/kilo-plugin/index.ts");
			expect(openFile).not.toHaveBeenCalled();
		});

		it("says the search was incomplete when a missing file was truncated", async () => {
			const { openFile } = renderSubfolderLink({ kind: "none", paths: [], truncated: true });

			await page.getByTestId("markdown-file-link").click();

			await expect.poll(() => toastError.mock.calls.length).toBe(1);
			expect(toastError).toHaveBeenCalledWith(
				"File not found: src/kilo-plugin/index.ts. The search was incomplete.",
			);
			expect(openFile).not.toHaveBeenCalled();
		});
	});
});

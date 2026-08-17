import { existsSync } from "node:fs";
import path from "node:path";

import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

import { packagedResourcesDirectory } from "@anaconda-agentic-desktop/e2e";

import {
	getNteractMcpArtifact,
	getRuntimedArtifact,
} from "../../src/main/distribution/artifacts.js";

type DesktopBridge = {
	invoke?: (
		channel: string,
		input: { featureId: string; channel: string; args?: unknown },
	) => Promise<unknown>;
};

type NotebookStatusResult =
	| {
			ok: true;
			value: {
				availability: { status: string; reason?: string };
				process: { status: string; pid?: number };
				daemon: { version: string } | null;
			};
	  }
	| { ok: false; error: { message: string } };

export class NotebookPage {
	#firstFrameSrc: string | null = null;
	#secondFrameSrc: string | null = null;

	#activeFrame() {
		return getPage().locator('iframe[data-qa-id="notebook-frame"]:visible');
	}

	async openKiloChat(): Promise<void> {
		await getPage().waitForURL(/#\/plugins\/chat/);
		await expect(getPage().getByTestId("kilo-chat-page")).toBeVisible();
	}

	async addTwoNotebooks(): Promise<void> {
		await getPage().getByTestId("chat-right-panel-toggle").click();
		await getPage().getByTestId("chat-right-panel-open-notebook-notebook").click();
		await expect(getPage().getByRole("button", { name: "Notebook 1", exact: true })).toBeVisible();
		this.#firstFrameSrc = await this.#activeFrame().getAttribute("src");

		await getPage().getByTestId("chat-right-panel-add-tab").click();
		await getPage().getByTestId("chat-right-panel-add-notebook-notebook").click();
		await expect(getPage().getByRole("button", { name: "Notebook 2", exact: true })).toBeVisible();
		this.#secondFrameSrc = await this.#activeFrame().getAttribute("src");
	}

	async verifyDistinctProtocolFramesAndSwitching(): Promise<void> {
		expect(this.#firstFrameSrc).toMatch(
			/^anaconda-agentic-desktop(-dev)?:\/\/notebook\/?\?notebook_id=/,
		);
		expect(this.#secondFrameSrc).toMatch(
			/^anaconda-agentic-desktop(-dev)?:\/\/notebook\/?\?notebook_id=/,
		);
		expect(this.#secondFrameSrc).not.toBe(this.#firstFrameSrc);

		await getPage().getByRole("button", { name: "Notebook 1", exact: true }).click();
		await expect(this.#activeFrame()).toHaveAttribute("src", this.#firstFrameSrc!);
		await getPage().getByRole("button", { name: "Notebook 2", exact: true }).click();
		await expect(this.#activeFrame()).toHaveAttribute("src", this.#secondFrameSrc!);
	}

	async #status(): Promise<NotebookStatusResult> {
		return getPage().evaluate(async (): Promise<NotebookStatusResult> => {
			const bridge = (globalThis as { desktopApi?: DesktopBridge }).desktopApi;
			if (typeof bridge?.invoke !== "function") {
				return { ok: false, error: { message: "window.desktopApi.invoke is unavailable" } };
			}
			return (await bridge.invoke("feature:invoke", {
				featureId: "notebook",
				channel: "status",
			})) as NotebookStatusResult;
		});
	}

	async verifyStatusChannelReportsSingleton(): Promise<void> {
		const result = await this.#status();
		if (!result.ok) {
			throw new Error(`Expected notebook:status to succeed, got "${result.error.message}"`);
		}
		expect(result.value.availability.status).toBe("available");
		expect(
			["external", "bundled"],
			"Notebook status should identify a reachable external or bundled daemon",
		).toContain(result.value.process.status);
	}

	async verifyDaemonIsReachable(): Promise<void> {
		const result = await this.#status();
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.availability.status).toBe("available");
		expect(result.value.daemon?.version).toBeTruthy();
	}

	async verifyBundledResources(): Promise<void> {
		const resources = packagedResourcesDirectory();
		expect(existsSync(path.join(resources, "notebook", "index.html"))).toBe(true);
		expect(existsSync(path.join(resources, "notebook", "output-frame.html"))).toBe(true);
		const mcp = getNteractMcpArtifact();
		const mcpRoot = path.join(resources, "nteract-mcp", mcp.target);
		expect(existsSync(path.join(mcpRoot, mcp.nteractMcp.executable))).toBe(true);
		expect(existsSync(path.join(mcpRoot, mcp.runt.executable))).toBe(true);
		const runtimed = getRuntimedArtifact();
		expect(
			existsSync(path.join(resources, "runtimed", runtimed.target, runtimed.executable)),
			"The packaged app should contain the host-platform runtimed daemon",
		).toBe(true);
	}

	async executeCellAndVerifyOutput(): Promise<void> {
		const notebook = getPage().frameLocator('iframe[data-qa-id="notebook-frame"]:visible');
		await expect(notebook.locator('[data-testid="notebook-toolbar"]')).toBeVisible({
			timeout: 30_000,
		});
		await expect(notebook.locator("[data-notebook-synced]")).toHaveAttribute(
			"data-notebook-synced",
			"true",
			{ timeout: 30_000 },
		);
		await expect(notebook.locator('[data-testid="kernel-status"]')).toHaveAttribute(
			"data-kernel-status",
			"idle",
			{ timeout: 120_000 },
		);

		const codeCells = notebook.locator('[data-cell-type="code"]');
		if ((await codeCells.count()) === 0) {
			await notebook.locator('[data-testid="add-code-cell-button"]').click();
		}
		await expect(codeCells).toHaveCount(1);
		const codeCell = codeCells;
		await expect(codeCell).toBeVisible();
		await codeCell.locator('.cm-content[contenteditable="true"]').evaluate((node, source) => {
			const editor = (
				node as HTMLElement & {
					cmTile?: {
						view?: {
							state: { doc: { length: number } };
							dispatch: (transaction: unknown) => void;
						};
					};
				}
			).cmTile?.view;
			if (!editor) throw new Error("CodeMirror view was not attached to the notebook cell");
			editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } });
		}, "sum(range(101))");
		await codeCell.locator('[data-testid="execute-button"]').click();
		await expect(codeCell.locator('[data-slot="ansi-output"]')).toContainText("5050", {
			timeout: 60_000,
		});
	}

	async executeIsolatedJavaScriptOutput(): Promise<void> {
		const notebook = getPage().frameLocator('iframe[data-qa-id="notebook-frame"]:visible');
		const codeCell = notebook.locator('[data-cell-type="code"]');
		await codeCell.locator('.cm-content[contenteditable="true"]').evaluate((node, source) => {
			const editor = (
				node as HTMLElement & {
					cmTile?: {
						view?: {
							state: { doc: { length: number } };
							dispatch: (transaction: unknown) => void;
						};
					};
				}
			).cmTile?.view;
			if (!editor) throw new Error("CodeMirror view was not attached to the notebook cell");
			editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } });
		}, `from IPython.display import Javascript\ndisplay(Javascript("element.id='electron-csp-js-output'; element.textContent='isolated JavaScript ran'"))`);
		await codeCell.locator('[data-testid="execute-button"]').click();

		const isolatedFrame = codeCell.locator('iframe[data-slot="isolated-frame"]');
		await expect(isolatedFrame).toBeVisible({ timeout: 60_000 });
		await expect(isolatedFrame).toHaveAttribute("src", /\/output-frame\.html(?:\?|$)/);
		const sandbox = (await isolatedFrame.getAttribute("sandbox")) ?? "";
		expect(sandbox.split(/\s+/)).not.toContain("allow-same-origin");
		await expect(
			notebook
				.frameLocator('[data-cell-type="code"] iframe[data-slot="isolated-frame"]')
				.locator("#electron-csp-js-output"),
		).toContainText("isolated JavaScript ran", { timeout: 30_000 });
	}

	async saveCurrentNotebook(savePath: string): Promise<void> {
		const notebook = getPage().frameLocator('iframe[data-qa-id="notebook-frame"]:visible');
		const editor = notebook.locator('[data-cell-type="code"] .cm-content[contenteditable="true"]');
		await editor.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
		await expect.poll(() => existsSync(savePath), { timeout: 30_000 }).toBe(true);
	}
}

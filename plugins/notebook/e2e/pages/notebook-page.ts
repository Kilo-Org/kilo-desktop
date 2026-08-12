import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect, test } from "@playwright/test";

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
				relayPort: number;
				availability: { status: string; reason?: string };
				daemon: { version: string } | null;
			};
	  }
	| { ok: false; error: { message: string } };

export class NotebookPage {
	#firstFrameSrc: string | null = null;
	#secondFrameSrc: string | null = null;

	async openKiloChat(): Promise<void> {
		await getPage().waitForURL(/#\/plugins\/chat/);
		await expect(getPage().getByTestId("kilo-chat-page")).toBeVisible();
	}

	async addTwoNotebooks(): Promise<void> {
		await getPage().getByTestId("chat-right-panel-toggle").click();
		await getPage().getByTestId("chat-right-panel-open-notebook-notebook").click();
		await expect(getPage().getByTestId("notebook-title")).toHaveText("Notebook 1");
		this.#firstFrameSrc = await getPage().getByTestId("notebook-frame").getAttribute("src");

		await getPage().getByTestId("chat-right-panel-add-tab").click();
		await getPage().getByTestId("chat-right-panel-add-notebook-notebook").click();
		await expect(getPage().getByTestId("notebook-title")).toHaveText("Notebook 2");
		this.#secondFrameSrc = await getPage().getByTestId("notebook-frame").getAttribute("src");
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
		await expect(getPage().getByTestId("notebook-frame")).toHaveAttribute(
			"src",
			this.#firstFrameSrc!,
		);
		await getPage().getByRole("button", { name: "Notebook 2", exact: true }).click();
		await expect(getPage().getByTestId("notebook-frame")).toHaveAttribute(
			"src",
			this.#secondFrameSrc!,
		);
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

	async verifyStatusChannelReportsBoundRelay(): Promise<void> {
		const result = await this.#status();
		if (!result.ok) {
			throw new Error(`Expected notebook:status to succeed, got "${result.error.message}"`);
		}
		expect(result.value.relayPort).toBeGreaterThan(0);
	}

	async verifyDaemonIsReachable(): Promise<void> {
		if (process.env["RUNTIMED_E2E_EXTERNAL"] !== "1") {
			test.info().annotations.push({
				type: "skipped-assertion",
				description: "external runtimed reachability unchecked (set RUNTIMED_E2E_EXTERNAL=1)",
			});
			return;
		}
		const result = await this.#status();
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.availability.status).toBe("available");
		expect(result.value.daemon?.version).toBeTruthy();
	}
}

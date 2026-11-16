import type { Page, TestInfo } from "@playwright/test";

type ConsoleEntry = {
	type: string;
	text: string;
};

/**
 * Collects renderer console messages during a test so they can be attached
 * to the Playwright report on failure. One instance per test — not a module singleton.
 */
export class ConsoleLogCollector {
	private readonly logs: ConsoleEntry[] = [];
	private readonly handler: (message: { type: () => string; text: () => string }) => void;

	constructor(private readonly page: Page) {
		this.handler = (message) => {
			this.logs.push({ type: message.type(), text: message.text() });
		};
	}

	start(): void {
		this.page.on("console", this.handler);
	}

	stop(): void {
		this.page.off("console", this.handler);
	}

	async attach(testInfo: Pick<TestInfo, "attach">): Promise<void> {
		if (this.logs.length === 0) return;
		const body = this.logs.map((entry) => `[${entry.type}] ${entry.text}`).join("\n");
		await testInfo.attach("console.log", {
			body,
			contentType: "text/plain",
		});
	}
}

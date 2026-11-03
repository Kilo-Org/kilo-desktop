import { describe, expect, it } from "vitest";

import { paneTypeOf } from "./telemetry";

describe("paneTypeOf", () => {
	it("reports bundled pane kinds by the ids origin's events used", () => {
		expect(paneTypeOf("kilo.chat/agent")).toBe("chat");
		expect(paneTypeOf("kilo.files/files")).toBe("files.files");
		expect(paneTypeOf("kilo.git/changes")).toBe("git.changes");
		expect(paneTypeOf("kilo.terminal/terminal")).toBe("terminal.terminal");
		expect(paneTypeOf("kilo.browser/browser")).toBe("browser.browser");
		expect(paneTypeOf("kilo.notebook/notebook")).toBe("notebook.notebook");
	});

	it("reports other kinds as they are", () => {
		expect(paneTypeOf("acme.charts/chart")).toBe("acme.charts/chart");
	});
});

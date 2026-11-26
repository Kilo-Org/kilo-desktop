import type { BrowserOptions } from "@sentry/react";
import { describe, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/electron/renderer", () => ({ init }));
vi.mock("@sentry/react", () => ({ init: vi.fn() }));
vi.mock("./bridge", () => ({ getKernelBridge: () => ({}) }));

import "./instrument";
const options = init.mock.calls[0]![0] as BrowserOptions;

describe("renderer Sentry init", () => {
	it("drops console breadcrumbs, whose logged text can quote a credential", () => {
		expect(options.beforeBreadcrumb!({ category: "console", message: "server output" })).toBeNull();
	});

	it("keeps other breadcrumbs for main to scrub", () => {
		const breadcrumb = { category: "ui.click", message: "button" };
		expect(options.beforeBreadcrumb!(breadcrumb)).toBe(breadcrumb);
	});

	it("keeps stack frame variables out of reports", () => {
		expect(options.dataCollection).toMatchObject({ stackFrameVariables: false });
	});
});

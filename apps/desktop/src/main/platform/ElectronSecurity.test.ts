import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

import { ElectronSecurity, isTrustedIpcSender, isTrustedRendererUrl } from "./ElectronSecurity.js";

describe("ElectronSecurity", () => {
	it.each([
		"anaconda-agentic-desktop://app/",
		"anaconda-agentic-desktop://app/settings/",
		"anaconda-agentic-desktop-dev://app/",
	])("trusts renderer URL %s", (url) => {
		expect(isTrustedRendererUrl(url)).toBe(true);
	});

	it.each([
		"https://app/",
		"anaconda-agentic-desktop://evil/",
		"file:///tmp/index.html",
		"javascript:alert(1)",
		"not a url",
	])("rejects renderer URL %s", (url) => {
		expect(isTrustedRendererUrl(url)).toBe(false);
	});

	it("trusts IPC senders by their frame URL", () => {
		expect(
			isTrustedIpcSender({
				senderFrame: { url: "anaconda-agentic-desktop://app/" },
			} as never),
		).toBe(true);
		expect(
			isTrustedIpcSender({
				senderFrame: { url: "https://evil.example/" },
			} as never),
		).toBe(false);
		expect(isTrustedIpcSender({ senderFrame: undefined } as never)).toBe(false);
	});

	it("denies all permissions and restores handlers on dispose", () => {
		const setPermissionCheckHandler = vi.fn();
		const setPermissionRequestHandler = vi.fn();
		const session = { setPermissionCheckHandler, setPermissionRequestHandler };
		const security = new ElectronSecurity();

		const dispose = security.install(session as never);

		expect(setPermissionCheckHandler).toHaveBeenCalledWith(expect.any(Function));
		expect(setPermissionRequestHandler).toHaveBeenCalledWith(expect.any(Function));
		expect(setPermissionCheckHandler.mock.calls[0]?.[0]?.()).toBe(false);

		const requestCallback = vi.fn();
		setPermissionRequestHandler.mock.calls[0]?.[0]?.(
			{} as never,
			"clipboard-read",
			requestCallback,
		);
		expect(requestCallback).toHaveBeenCalledWith(false);

		dispose();
		expect(setPermissionCheckHandler).toHaveBeenLastCalledWith(null);
		expect(setPermissionRequestHandler).toHaveBeenLastCalledWith(null);
	});
});

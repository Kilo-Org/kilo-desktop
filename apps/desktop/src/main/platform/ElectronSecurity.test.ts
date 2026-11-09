import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

import { CLIPBOARD_WRITE_EMBEDDED_PERMISSION, type EmbeddedWebHost } from "./embedded-web-host.js";

import {
	configureTrustedSchemes,
	ElectronSecurity,
	isEmbeddedHostPermissionGranted,
	isTrustedIpcSender,
	isTrustedRendererUrl,
} from "./ElectronSecurity.js";

describe("ElectronSecurity", () => {
	beforeEach(() => {
		configureTrustedSchemes(false);
	});

	it.each(["kilo-desktop://app/", "kilo-desktop://app/settings/"])(
		"trusts renderer URL %s",
		(url) => {
			expect(isTrustedRendererUrl(url)).toBe(true);
		},
	);

	it.each([
		"https://app/",
		"kilo-desktop://evil/",
		"file:///tmp/index.html",
		"javascript:alert(1)",
		"not a url",
	])("rejects renderer URL %s", (url) => {
		expect(isTrustedRendererUrl(url)).toBe(false);
	});

	it("trusts IPC senders by their frame URL", () => {
		expect(
			isTrustedIpcSender({
				senderFrame: { url: "kilo-desktop://app/" },
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
			{ requestingUrl: "kilo-desktop://app/" },
		);
		expect(requestCallback).toHaveBeenCalledWith(false);

		dispose();
		expect(setPermissionCheckHandler).toHaveBeenLastCalledWith(null);
		expect(setPermissionRequestHandler).toHaveBeenLastCalledWith(null);
	});

	describe("embedded host permissions", () => {
		const notebookHost: EmbeddedWebHost = {
			host: "notebook",
			root: "/plugins/notebook/build/notebook",
			permissions: [CLIPBOARD_WRITE_EMBEDDED_PERMISSION],
		};

		it.each(["kilo-desktop://notebook", "kilo-desktop://notebook/index.html?notebook_id=1"])(
			"grants clipboard write to the declaring host at %s",
			(requesting) => {
				expect(
					isEmbeddedHostPermissionGranted("clipboard-sanitized-write", requesting, [notebookHost]),
				).toBe(true);
			},
		);

		it.each([
			["a sandboxed output frame", "clipboard-sanitized-write", "null"],
			["the app renderer", "clipboard-sanitized-write", "kilo-desktop://app/"],
			["another host", "clipboard-sanitized-write", "kilo-desktop://browser/"],
			["a web origin with the same host", "clipboard-sanitized-write", "https://notebook/"],
			["a missing origin", "clipboard-sanitized-write", undefined],
			["clipboard read", "clipboard-read", "kilo-desktop://notebook"],
			["other permissions", "media", "kilo-desktop://notebook"],
		])("denies %s", (_label, permission, requesting) => {
			expect(isEmbeddedHostPermissionGranted(permission, requesting, [notebookHost])).toBe(false);
		});

		it("never grants the app shell's reserved host, even if a host claims it", () => {
			const claimsAppHost: EmbeddedWebHost = { ...notebookHost, host: "app" };

			for (const requesting of ["kilo-desktop://app/", "kilo-desktop://app/index.html"]) {
				expect(
					isEmbeddedHostPermissionGranted("clipboard-sanitized-write", requesting, [claimsAppHost]),
				).toBe(false);
			}
		});

		it("applies declared permissions through both session handlers", () => {
			const setPermissionCheckHandler = vi.fn();
			const setPermissionRequestHandler = vi.fn();
			const session = { setPermissionCheckHandler, setPermissionRequestHandler };

			new ElectronSecurity().install(session as never, { embeddedHosts: () => [notebookHost] });
			const check = setPermissionCheckHandler.mock.calls[0]?.[0];
			const request = setPermissionRequestHandler.mock.calls[0]?.[0];
			const callback = vi.fn();

			expect(check?.({}, "clipboard-sanitized-write", "kilo-desktop://notebook")).toBe(true);
			expect(check?.({}, "clipboard-sanitized-write", "null")).toBe(false);
			request?.({}, "clipboard-sanitized-write", callback, {
				requestingUrl: "kilo-desktop://notebook/index.html",
			});
			request?.({}, "clipboard-read", callback, {
				requestingUrl: "kilo-desktop://notebook/index.html",
			});
			expect(callback.mock.calls).toEqual([[true], [false]]);
		});
	});

	describe("development build", () => {
		beforeEach(() => {
			configureTrustedSchemes(true);
		});

		it("trusts the dev-scheme renderer URL and rejects the production scheme", () => {
			expect(isTrustedRendererUrl("kilo-desktop-dev://app/")).toBe(true);
			expect(isTrustedRendererUrl("kilo-desktop://app/")).toBe(false);
		});
	});
});

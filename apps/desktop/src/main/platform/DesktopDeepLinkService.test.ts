import { describe, expect, it, vi } from "vitest";

import { DesktopDeepLinkService } from "./DesktopDeepLinkService.js";

function createHost(overrides?: {
	readonly argv?: readonly string[];
	readonly hasWindow?: () => boolean;
}) {
	const listeners = {
		openUrl: undefined as ((url: string) => void) | undefined,
		secondInstance: undefined as ((commandLine: readonly string[]) => void) | undefined,
	};
	const host = {
		scheme: "kilo-desktop",
		links: [
			{
				host: "model-catalog",
				to: "/settings/local-model-server",
				searchParam: "catalogModel",
			},
		],
		registerProtocolClient: vi.fn(),
		onOpenUrl: vi.fn((listener: (url: string) => void) => {
			listeners.openUrl = listener;
			return () => {
				listeners.openUrl = undefined;
			};
		}),
		onSecondInstance: vi.fn((listener: (commandLine: readonly string[]) => void) => {
			listeners.secondInstance = listener;
			return () => {
				listeners.secondInstance = undefined;
			};
		}),
		argv: vi.fn(() => overrides?.argv ?? []),
		hasWindow: vi.fn(() => overrides?.hasWindow?.() ?? false),
		reveal: vi.fn(),
		replaceLoadingUrl: vi.fn(),
		navigate: vi.fn(),
	};
	return { host, listeners };
}

describe("DesktopDeepLinkService", () => {
	it("registers the OS protocol client and queues a cold-start argv link", () => {
		const { host } = createHost({
			argv: ["kilo-desktop", "kilo-desktop://model-catalog/catalog-model"],
		});
		const service = new DesktopDeepLinkService(host);

		service.start();

		expect(host.registerProtocolClient).toHaveBeenCalledWith("kilo-desktop");
		expect(service.takeInitialRoute()).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
		expect(service.takeInitialRoute()).toBeUndefined();
		expect(host.navigate).not.toHaveBeenCalled();
	});

	it("ignores argv that is not an allowlisted deep link", () => {
		const { host } = createHost({
			argv: ["kilo-desktop", "kilo-desktop://app/#/plugins/chat"],
		});
		const service = new DesktopDeepLinkService(host);

		service.start();

		expect(service.takeInitialRoute()).toBeUndefined();
	});

	it("replaces the in-flight window URL when a link arrives before the renderer is ready", () => {
		const { host, listeners } = createHost({ hasWindow: () => true });
		const service = new DesktopDeepLinkService(host);
		service.start();
		expect(service.takeInitialRoute()).toBeUndefined();

		listeners.openUrl?.("kilo-desktop://model-catalog/catalog-model");

		expect(host.replaceLoadingUrl).toHaveBeenCalledWith({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
		expect(host.navigate).not.toHaveBeenCalled();
		expect(host.reveal).not.toHaveBeenCalled();
	});

	it("navigates and reveals once the window is ready", () => {
		const { host, listeners } = createHost({ hasWindow: () => true });
		const service = new DesktopDeepLinkService(host);
		service.start();
		service.takeInitialRoute();
		service.markWindowReady();

		listeners.secondInstance?.([
			"kilo-desktop",
			"kilo-desktop://model-catalog/48d448b0-2634-4c32-b3fe-56a26483c904",
		]);

		expect(host.reveal).toHaveBeenCalled();
		expect(host.navigate).toHaveBeenCalledWith({
			path: "/settings/local-model-server",
			search: { catalogModel: "48d448b0-2634-4c32-b3fe-56a26483c904" },
		});
	});

	it("reveals on second-instance even without a deep link", () => {
		const { host, listeners } = createHost({ hasWindow: () => true });
		const service = new DesktopDeepLinkService(host);
		service.start();
		service.markWindowReady();

		listeners.secondInstance?.(["kilo-desktop"]);

		expect(host.reveal).toHaveBeenCalledOnce();
		expect(host.navigate).not.toHaveBeenCalled();
	});

	it("flushes a pending link over navigate after the window becomes ready", () => {
		const { host, listeners } = createHost();
		const service = new DesktopDeepLinkService(host);
		service.start();
		service.takeInitialRoute();

		listeners.openUrl?.("kilo-desktop://model-catalog/catalog-model");
		expect(host.navigate).not.toHaveBeenCalled();

		service.markWindowReady();

		expect(host.navigate).toHaveBeenCalledWith({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
	});

	it("queues a link when the window is gone after ready", () => {
		const { host, listeners } = createHost();
		const service = new DesktopDeepLinkService(host);
		service.start();
		service.markWindowReady();

		listeners.openUrl?.("kilo-desktop://model-catalog/catalog-model");

		expect(host.navigate).not.toHaveBeenCalled();
		expect(service.takeInitialRoute()).toEqual({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
	});

	it("replaces the loading URL after the window is recreated", () => {
		const { host, listeners } = createHost({ hasWindow: () => true });
		const service = new DesktopDeepLinkService(host);
		service.start();
		service.markWindowReady();
		service.markWindowClosed();

		listeners.openUrl?.("kilo-desktop://model-catalog/catalog-model");

		expect(host.replaceLoadingUrl).toHaveBeenCalledWith({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
		expect(host.navigate).not.toHaveBeenCalled();
	});

	it("stops handling URLs after dispose", () => {
		const { host, listeners } = createHost();
		const service = new DesktopDeepLinkService(host);
		service.start();
		service.markWindowReady();
		service.dispose();

		listeners.openUrl?.("kilo-desktop://model-catalog/catalog-model");
		listeners.secondInstance?.(["kilo-desktop://model-catalog/catalog-model"]);

		expect(host.navigate).not.toHaveBeenCalled();
		expect(host.reveal).not.toHaveBeenCalled();
	});
});

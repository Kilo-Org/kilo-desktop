import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi, LocalApi } from "@anaconda-agentic-desktop/contracts";
import { defineMethod, type FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";
import { applyDocumentColorScheme } from "@/platform/theme/color-scheme";

const demoChannels = {
	greet: defineMethod(
		{
			parse(value: unknown): { name: string } {
				if (
					typeof value !== "object" ||
					value === null ||
					!("name" in value) ||
					typeof value.name !== "string"
				) {
					throw new Error("Expected an object with a string name.");
				}
				return { name: value.name };
			},
		},
		{
			parse(value: unknown): string {
				if (typeof value !== "string") throw new Error("Expected a string.");
				return value;
			},
		},
	),
} as const;

function demoRegister(mainSdk: Parameters<FeatureRegistration["mainRegister"]>[0]) {
	mainSdk.channels(demoChannels).handle("greet", (args) => `Hello, ${args.name}!`);
}

const demoFeature: FeatureRegistration = {
	id: "demo",
	mainRegister: demoRegister,
	browserRegister: demoRegister,
};

afterEach(() => {
	cleanup();
	applyDocumentColorScheme("light");
	vi.unstubAllGlobals();
});

describe("createAppFeatureSystem (browser mode)", () => {
	it("boots browserRegister features in-process", async () => {
		const system = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature]);
		await expect(system.getSdk("demo").invoke("greet", { name: "World" })).resolves.toBe(
			"Hello, World!",
		);
	});

	it("reports undelivered notifications instead of throwing", () => {
		const system = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature]);
		const sdk = system.getSdk("demo");
		const shown = sdk.notifications.show({ type: "info", title: "Hi", message: "There" });
		expect(shown.delivered).toBe(false);
		expect(shown.reason).toMatch(/not yet wired/);
		const badge = sdk.notifications.setBadge(3);
		expect(badge.delivered).toBe(false);
	});

	it("peeks and subscribes to the effective theme", () => {
		const api = createBrowserLocalApi();
		const system = createAppFeatureSystem(api, [demoFeature]);
		const sdk = system.getSdk("demo");

		expect(sdk.theme.peek()).toBe("light");
		applyDocumentColorScheme("dark");
		expect(sdk.theme.peek()).toBe("dark");

		const seen: Array<"dark" | "light"> = [];
		const unsub = sdk.theme.subscribe((theme) => seen.push(theme));
		expect(seen).toEqual(["dark"]);

		applyDocumentColorScheme("light");
		expect(seen).toEqual(["dark", "light"]);
		unsub();
	});

	it("adapts LocalApi auth state and operations to sdk.auth", async () => {
		const authenticated = {
			status: "authenticated",
			user: { userId: "user-1" },
		} as const;
		const stopOnChanged = vi.fn();
		let pushSession:
			| ((session: Awaited<ReturnType<LocalApi["auth"]["getSession"]>>) => void)
			| undefined;
		const auth: LocalApi["auth"] = {
			getSession: vi.fn().mockResolvedValue(authenticated),
			refresh: vi.fn().mockResolvedValue({ status: "error", reason: "expired" }),
			login: vi.fn().mockResolvedValue(authenticated),
			logout: vi.fn().mockResolvedValue({ status: "anonymous" }),
			onChanged(listener) {
				pushSession = listener;
				return stopOnChanged;
			},
		};
		const api = { ...createBrowserLocalApi(), auth };
		const sdkAuth = createAppFeatureSystem(api, []).getSdk("auth-consumer").auth;
		const listener = vi.fn();
		const unsubscribe = sdkAuth.subscribe(listener);

		expect(listener).toHaveBeenCalledWith({ status: "anonymous" });
		await expect.poll(() => sdkAuth.peek()).toEqual(authenticated);
		pushSession?.({ status: "error", reason: "pushed" });
		expect(sdkAuth.peek()).toEqual({ status: "error", reason: "pushed" });
		await expect(sdkAuth.getSession()).resolves.toEqual(authenticated);
		await expect(sdkAuth.refresh()).resolves.toEqual({ status: "error", reason: "expired" });
		await expect(sdkAuth.login()).resolves.toEqual(authenticated);
		await expect(sdkAuth.logout()).resolves.toEqual({ status: "anonymous" });

		unsubscribe();
		expect(stopOnChanged).toHaveBeenCalledOnce();
	});

	it("bridges sdk.shell to the LocalApi shell adapter", async () => {
		const open = vi.fn(() => ({}) as Window);
		vi.stubGlobal("open", open);
		const system = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature]);
		const sdk = system.getSdk("demo");

		await expect(sdk.shell.openExternal("https://example.com")).resolves.toEqual({
			opened: true,
		});
		expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
	});

	it("rejects sdk.fs calls (not wired yet)", async () => {
		const system = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature]);
		const sdk = system.getSdk("demo");
		await expect(sdk.fs.readFile("x")).rejects.toThrow(/not yet wired/);
		await expect(sdk.fs.writeFile("x", "y")).rejects.toThrow(/not yet wired/);
		await expect(sdk.fs.exists("x")).rejects.toThrow(/not yet wired/);
		await expect(sdk.fs.mkdir("x")).rejects.toThrow(/not yet wired/);
		await expect(sdk.fs.readdir("x")).rejects.toThrow(/not yet wired/);
		await expect(sdk.fs.remove("x")).rejects.toThrow(/not yet wired/);
	});

	it("wires sdk.navigate and sdk.location to the provided navigation delegate", () => {
		const navigate = vi.fn();
		const system = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature], {
			navigate,
			subscribe: (fn) => {
				fn({ path: "/here", search: {} });
				return () => {};
			},
			peek: () => ({ path: "/here", search: {} }),
		});
		const sdk = system.getSdk("demo");

		sdk.navigate("/plugins/todos", { search: { filter: "open" } });
		expect(navigate).toHaveBeenCalledWith("/plugins/todos", { search: { filter: "open" } });
		expect(sdk.location.peek()).toEqual({ path: "/here", search: {} });
	});

	it("falls back to inert warn-once navigation when no delegate is provided", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const system = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature]);
			const sdk = system.getSdk("demo");
			expect(() => sdk.navigate("/plugins/todos")).not.toThrow();
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("no shell router is wired"));
			expect(sdk.location.peek()).toEqual({ path: "/", search: {} });
		} finally {
			warn.mockRestore();
		}
	});
});

describe("createAppFeatureSystem (Electron mode)", () => {
	it("routes invoke through the Electron bridge when present", async () => {
		const bridge = {
			invoke: vi.fn().mockResolvedValue({ ok: true, value: "bridged" }),
			on: vi.fn(() => () => undefined),
		} as unknown as DesktopApi;
		vi.stubGlobal("desktopApi", bridge);

		const system = createAppFeatureSystem(createBrowserLocalApi(), []);
		const result = await system.services.featureRouter.invoke("any", "channel", {});
		expect(result).toBe("bridged");
		expect(bridge.invoke).toHaveBeenCalledWith("feature:invoke", {
			featureId: "any",
			channel: "channel",
			args: {},
		});
	});

	it("throws when the Electron bridge returns ok: false", async () => {
		const bridge = {
			invoke: vi.fn().mockResolvedValue({
				ok: false,
				error: { code: "INTERNAL", message: "nope" },
			}),
			on: vi.fn(() => () => undefined),
		} as unknown as DesktopApi;
		vi.stubGlobal("desktopApi", bridge);

		const system = createAppFeatureSystem(createBrowserLocalApi(), []);
		await expect(system.services.featureRouter.invoke("any", "channel", {})).rejects.toThrow(
			"nope",
		);
	});
});

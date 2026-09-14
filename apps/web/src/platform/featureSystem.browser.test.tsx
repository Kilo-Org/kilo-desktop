import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi, LocalApi } from "@anaconda-agentic-desktop/contracts";
import {
	defineMethod,
	type FeatureEvent,
	type FeatureRegistration,
} from "@anaconda-agentic-desktop/feature-sdk";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";
import { applyAppTheme } from "@/platform/theme/app-theme";
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
	applyAppTheme({ themeId: "kilo" });
	localStorage.clear();
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

	it("bridges sdk.notifications to the LocalApi notifications adapter", async () => {
		const show = vi.fn(async () => ({ delivered: true }));
		const setBadge = vi.fn(async () => ({ delivered: false, reason: "unsupported" }));
		const api = { ...createBrowserLocalApi(), notifications: { show, setBadge } };
		const sdk = createAppFeatureSystem(api, [demoFeature]).getSdk("demo");

		await expect(
			sdk.notifications.show({ type: "info", title: "Hi", message: "There" }),
		).resolves.toEqual({ delivered: true });
		expect(show).toHaveBeenCalledWith({ type: "info", title: "Hi", message: "There" });

		await expect(sdk.notifications.setBadge(3)).resolves.toEqual({
			delivered: false,
			reason: "unsupported",
		});
		expect(setBadge).toHaveBeenCalledWith({ count: 3 });
	});

	it("reports undelivered browser notifications without permission instead of throwing", async () => {
		const sdk = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature]).getSdk("demo");
		const result = await sdk.notifications.show({ type: "info", title: "Hi", message: "There" });
		// Headless browser tests never carry a granted notification permission.
		expect(result.delivered).toBe(false);
		expect(result.reason).toBeDefined();
	});

	it("reads and subscribes to the effective theme", () => {
		const api = createBrowserLocalApi();
		const system = createAppFeatureSystem(api, [demoFeature]);
		const sdk = system.getSdk("demo");

		expect(sdk.theme.appearance().mode).toBe("light");
		applyDocumentColorScheme("dark");
		expect(sdk.theme.appearance().mode).toBe("dark");

		const notify = vi.fn();
		const unsub = sdk.theme.subscribe(notify);
		expect(notify).toHaveBeenCalledOnce();

		applyDocumentColorScheme("light");
		expect(notify).toHaveBeenCalledTimes(2);
		expect(sdk.theme.appearance().mode).toBe("light");
		unsub();
	});

	it("notifies embedded surfaces when a preset changes without changing mode", () => {
		applyDocumentColorScheme("dark");
		const sdk = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature]).getSdk("demo");
		const notify = vi.fn();
		const unsubscribe = sdk.theme.subscribe(notify);
		const initial = sdk.theme.appearance();
		expect(sdk.theme.appearance()).toBe(initial);
		applyAppTheme({ themeId: "anaconda" });
		expect(notify).toHaveBeenCalledTimes(2);
		expect(sdk.theme.appearance()).toMatchObject({
			mode: "dark",
			themeId: "anaconda",
			shiki: "pierre-dark",
			terminal: { background: "#101314", foreground: "#f9fbfb" },
		});
		expect(sdk.theme.appearance()).toBe(sdk.theme.appearance());
		unsubscribe();
		applyAppTheme({ themeId: "kilo" });
		expect(notify).toHaveBeenCalledTimes(2);
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

	it("scopes sdk.fs calls with the calling feature's id through the LocalApi fs adapter", async () => {
		const calls: unknown[] = [];
		const fs: LocalApi["fs"] = {
			readFile: async (input) => {
				calls.push(["readFile", input]);
				return { content: "hello" };
			},
			writeFile: async (input) => {
				calls.push(["writeFile", input]);
			},
			exists: async (input) => {
				calls.push(["exists", input]);
				return { exists: true };
			},
			mkdir: async (input) => {
				calls.push(["mkdir", input]);
			},
			readdir: async (input) => {
				calls.push(["readdir", input]);
				return { entries: ["a.txt"] };
			},
			remove: async (input) => {
				calls.push(["remove", input]);
			},
		};
		const api = { ...createBrowserLocalApi(), fs };
		const sdk = createAppFeatureSystem(api, [demoFeature]).getSdk("demo");

		await expect(sdk.fs.readFile("notes/a.txt")).resolves.toBe("hello");
		await sdk.fs.writeFile("notes/a.txt", "hi");
		await expect(sdk.fs.exists("notes")).resolves.toBe(true);
		await sdk.fs.mkdir("notes");
		await expect(sdk.fs.readdir("notes")).resolves.toEqual(["a.txt"]);
		await sdk.fs.remove("notes/a.txt");

		expect(calls).toEqual([
			["readFile", { featureId: "demo", path: "notes/a.txt" }],
			["writeFile", { featureId: "demo", path: "notes/a.txt", content: "hi" }],
			["exists", { featureId: "demo", path: "notes" }],
			["mkdir", { featureId: "demo", path: "notes" }],
			["readdir", { featureId: "demo", path: "notes" }],
			["remove", { featureId: "demo", path: "notes/a.txt" }],
		]);
	});

	it("rejects sdk.fs calls in browser mode (no filesystem sandbox)", async () => {
		const system = createAppFeatureSystem(createBrowserLocalApi(), [demoFeature]);
		const sdk = system.getSdk("demo");
		await expect(sdk.fs.readFile("x")).rejects.toThrow(/not available in browser mode/);
		await expect(sdk.fs.writeFile("x", "y")).rejects.toThrow(/not available in browser mode/);
		await expect(sdk.fs.exists("x")).rejects.toThrow(/not available in browser mode/);
		await expect(sdk.fs.mkdir("x")).rejects.toThrow(/not available in browser mode/);
		await expect(sdk.fs.readdir("x")).rejects.toThrow(/not available in browser mode/);
		await expect(sdk.fs.remove("x")).rejects.toThrow(/not available in browser mode/);
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
	it("relays feature events in both directions and detaches on dispose", () => {
		const send = vi.fn();
		const detach = vi.fn();
		let receive: ((event: FeatureEvent) => void) | undefined;
		const bridge = {
			invoke: vi.fn(),
			send,
			on: vi.fn((_channel, listener: (event: FeatureEvent) => void) => {
				receive = listener;
				return detach;
			}),
		} as unknown as DesktopApi;
		vi.stubGlobal("desktopApi", bridge);

		const system = createAppFeatureSystem(createBrowserLocalApi(), []);
		const sdk = system.getSdk("renderer-feature");
		const received = vi.fn();
		sdk.events.on("main-feature.changed", received);

		sdk.events.emit("changed", { id: "renderer" });
		expect(send).toHaveBeenCalledWith("feature:event", {
			featureId: "renderer-feature",
			name: "changed",
			payload: { id: "renderer" },
		});

		receive?.({ featureId: "main-feature", name: "changed", payload: { id: "main" } });
		expect(received).toHaveBeenCalledWith({ id: "main" });

		system.dispose();
		expect(detach).toHaveBeenCalledOnce();
	});

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

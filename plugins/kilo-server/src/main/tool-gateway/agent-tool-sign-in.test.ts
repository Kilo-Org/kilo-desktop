import { describe, expect, it, vi } from "vitest";

import { AgentToolSignIn } from "./agent-tool-sign-in.js";

describe("AgentToolSignIn", () => {
	it("asks the auth source whether the user is signed in", async () => {
		const isSignedIn = vi.fn(async () => true);

		await expect(new AgentToolSignIn(isSignedIn).isSignedIn()).resolves.toBe(true);
		expect(isSignedIn).toHaveBeenCalledOnce();
	});

	it("remembers a decline for its feature and announces it once", () => {
		const signIn = new AgentToolSignIn(async () => false);
		const listener = vi.fn();
		signIn.subscribe(listener);

		expect(signIn.decline("environments")).toEqual({ declined: ["environments"] });
		signIn.decline("environments");

		expect(signIn.state).toEqual({ declined: ["environments"] });
		expect(listener).toHaveBeenCalledOnce();
	});

	it("keeps declines for different features apart", () => {
		const signIn = new AgentToolSignIn(async () => false);

		signIn.decline("notebook");

		expect(signIn.isDeclined("notebook")).toBe(true);
		expect(signIn.isDeclined("environments")).toBe(false);
		expect(signIn.isDeclined(undefined)).toBe(false);
		expect(signIn.decline("environments")).toEqual({ declined: ["notebook", "environments"] });
	});

	it("forgets every decline when the user signs in", () => {
		const signIn = new AgentToolSignIn(async () => false);
		signIn.decline("environments");
		signIn.decline("notebook");
		const listener = vi.fn();
		signIn.subscribe(listener);

		signIn.signedIn();
		signIn.signedIn();

		expect(signIn.state).toEqual({ declined: [] });
		expect(listener).toHaveBeenCalledOnce();
	});

	it("stops announcing to an unsubscribed listener", () => {
		const signIn = new AgentToolSignIn(async () => false);
		const listener = vi.fn();
		signIn.subscribe(listener)();

		signIn.decline("environments");

		expect(listener).not.toHaveBeenCalled();
	});
});

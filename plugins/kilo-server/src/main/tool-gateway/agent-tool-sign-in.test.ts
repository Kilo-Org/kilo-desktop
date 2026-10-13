import { describe, expect, it, vi } from "vitest";

import { AgentToolSignIn } from "./agent-tool-sign-in.js";

describe("AgentToolSignIn", () => {
	it("asks the auth source whether the user is signed in", async () => {
		const isSignedIn = vi.fn(async () => true);

		await expect(new AgentToolSignIn(isSignedIn).isSignedIn()).resolves.toBe(true);
		expect(isSignedIn).toHaveBeenCalledOnce();
	});

	it("remembers a decline and announces it once", () => {
		const signIn = new AgentToolSignIn(async () => false);
		const listener = vi.fn();
		signIn.subscribe(listener);

		expect(signIn.decline()).toEqual({ declined: true });
		signIn.decline();

		expect(signIn.state).toEqual({ declined: true });
		expect(listener).toHaveBeenCalledOnce();
	});

	it("forgets a decline when the user signs in", () => {
		const signIn = new AgentToolSignIn(async () => false);
		signIn.decline();
		const listener = vi.fn();
		signIn.subscribe(listener);

		signIn.signedIn();
		signIn.signedIn();

		expect(signIn.state).toEqual({ declined: false });
		expect(listener).toHaveBeenCalledOnce();
	});

	it("stops announcing to an unsubscribed listener", () => {
		const signIn = new AgentToolSignIn(async () => false);
		const listener = vi.fn();
		signIn.subscribe(listener)();

		signIn.decline();

		expect(listener).not.toHaveBeenCalled();
	});
});

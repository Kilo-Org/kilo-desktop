import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";

import { createTestShellDelegates } from "./test-helpers.js";
import { useSignInPrompt } from "./useSignInPrompt.js";

function sessionStore(initial: AuthSession) {
	let session = initial;
	const listeners = new Set<(next: AuthSession) => void>();
	return {
		auth: {
			subscribe(listener: (next: AuthSession) => void) {
				listeners.add(listener);
				listener(session);
				return () => listeners.delete(listener);
			},
			peek: () => session,
		},
		set(next: AuthSession) {
			session = next;
			for (const listener of listeners) listener(session);
		},
	};
}

function renderPrompt(auth: Partial<SDK["auth"]>) {
	const delegates = createTestShellDelegates();
	let result: boolean | undefined;
	function Probe() {
		const prompt = useSignInPrompt({
			auth: { ...delegates.auth, ...auth },
			telemetry: delegates.telemetry,
		});
		return (
			<>
				<button
					type="button"
					onClick={() => void prompt.requireSignIn().then((value) => (result = value))}
				>
					Request
				</button>
				<button type="button" onClick={() => void prompt.submit()}>
					Submit
				</button>
				<button type="button" onClick={prompt.cancel}>
					Dismiss
				</button>
			</>
		);
	}
	const view = render(<Probe />);
	return { result: () => result, baseElement: view.baseElement };
}

afterEach(cleanup);

describe("useSignInPrompt", () => {
	it("resolves a waiting request after successful sign-in", async () => {
		const store = sessionStore({ status: "anonymous" });
		const login = vi.fn(async (): Promise<AuthSession> => {
			const session: AuthSession = { status: "authenticated", user: { username: "ada" } };
			store.set(session);
			return session;
		});
		const view = renderPrompt({ ...store.auth, login });
		const screen = page.elementLocator(view.baseElement);

		await screen.getByRole("button", { name: "Request" }).click();
		await screen.getByRole("button", { name: "Submit" }).click();

		await expect.poll(view.result).toBe(true);
	});

	it("resolves a waiting request as false when dismissed", async () => {
		const store = sessionStore({ status: "anonymous" });
		const view = renderPrompt(store.auth);
		const screen = page.elementLocator(view.baseElement);

		await screen.getByRole("button", { name: "Request" }).click();
		await screen.getByRole("button", { name: "Dismiss" }).click();

		await expect.poll(view.result).toBe(false);
	});
});

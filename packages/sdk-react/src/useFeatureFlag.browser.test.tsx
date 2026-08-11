import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ShellDelegates } from "@anaconda-agentic-desktop/feature-sdk";

import { createFeatureSystem, SdkProvider } from "./SdkProvider.js";
import { createTestShellDelegates } from "./test-helpers.js";
import { useFeatureFlag } from "./useFeatureFlag.js";

type FlagDelegate = ShellDelegates["featureFlags"];

function delegatesWithFlags(featureFlags: Partial<FlagDelegate>): ShellDelegates {
	const base = createTestShellDelegates();
	return { ...base, featureFlags: { ...base.featureFlags, ...featureFlags } };
}

function Probe({ flagKey, defaultValue }: { flagKey: string; defaultValue?: unknown }) {
	const value = useFeatureFlag(flagKey, defaultValue as never);
	return <span data-testid="value">{JSON.stringify(value)}</span>;
}

function renderProbe(shellDelegates: ShellDelegates, flagKey: string, defaultValue?: unknown) {
	const system = createFeatureSystem({ shellDelegates, features: [] });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<Probe flagKey={flagKey} defaultValue={defaultValue} />
		</SdkProvider>,
	);
	return () => baseElement.querySelector('[data-testid="value"]')?.textContent ?? null;
}

describe("useFeatureFlag", () => {
	afterEach(cleanup);

	it("returns false when the key is absent and no default is given", async () => {
		const value = renderProbe(delegatesWithFlags({ peek: () => ({}) }), "todos.newEditor");

		await expect.poll(value).toBe("false");
	});

	it("returns the provided default when the key is absent", async () => {
		const value = renderProbe(delegatesWithFlags({ peek: () => ({}) }), "todos.maxItems", 100);

		await expect.poll(value).toBe("100");
	});

	it("returns the resolved value the delegate reports", async () => {
		const value = renderProbe(
			delegatesWithFlags({
				peek: () => ({ "todos.newEditor": true }),
				subscribe(fn) {
					fn({ "todos.newEditor": true });
					return () => {};
				},
			}),
			"todos.newEditor",
		);

		await expect.poll(value).toBe("true");
	});

	it("re-renders when the delegate pushes a new value", async () => {
		let push: ((flags: Record<string, unknown>) => void) | undefined;
		let current: Record<string, unknown> = { "todos.newEditor": false };
		const value = renderProbe(
			delegatesWithFlags({
				peek: () => current,
				subscribe(fn) {
					push = (flags) => {
						current = flags;
						fn(flags);
					};
					fn(current);
					return () => {};
				},
			}),
			"todos.newEditor",
		);

		await expect.poll(value).toBe("false");

		push?.({ "todos.newEditor": true });

		await expect.poll(value).toBe("true");
	});
});

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { LocalApi } from "@anaconda-agentic-desktop/contracts";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";

import { useFeatureFlag } from "./useFeatureFlag";

type FlagOverrides = Partial<LocalApi["featureFlags"]>;

function fakeLocalApi(featureFlags: FlagOverrides = {}): LocalApi {
	const api = createBrowserLocalApi();
	return { ...api, featureFlags: { ...api.featureFlags, ...featureFlags } };
}

function Probe({ flagKey, defaultValue }: { flagKey: string; defaultValue?: unknown }) {
	const value = useFeatureFlag(flagKey, defaultValue as never);
	return <span data-testid="value">{JSON.stringify(value)}</span>;
}

function renderProbe(api: LocalApi, flagKey: string, defaultValue?: unknown) {
	const system = createAppFeatureSystem(api);
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
		const value = renderProbe(fakeLocalApi({ getAllFlags: async () => ({}) }), "todos.newEditor");

		await expect.poll(value).toBe("false");
	});

	it("returns the provided default when the key is absent", async () => {
		const value = renderProbe(
			fakeLocalApi({ getAllFlags: async () => ({}) }),
			"todos.maxItems",
			100,
		);

		await expect.poll(value).toBe("100");
	});

	it("returns the resolved value after getAllFlags lands", async () => {
		const value = renderProbe(
			fakeLocalApi({ getAllFlags: async () => ({ "todos.newEditor": true }) }),
			"todos.newEditor",
		);

		await expect.poll(value).toBe("true");
	});

	it("re-renders when onChanged pushes a new value", async () => {
		let push: ((flags: Record<string, unknown>) => void) | undefined;
		const value = renderProbe(
			fakeLocalApi({
				getAllFlags: async () => ({ "todos.newEditor": false }),
				onChanged(listener) {
					push = listener;
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

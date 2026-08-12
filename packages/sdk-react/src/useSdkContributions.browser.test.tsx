import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createFeatureSystem, SdkProvider } from "./SdkProvider.js";
import { createTestShellDelegates } from "./test-helpers.js";
import { useSdkContributions } from "./useSdkContributions.js";

function Probe({ zone }: { zone: string }) {
	const contributions = useSdkContributions(zone);
	return <output data-testid="contributions">{contributions.map(({ id }) => id).join(",")}</output>;
}

afterEach(cleanup);

describe("useSdkContributions", () => {
	it("tracks live contributions for an arbitrary plugin-hosted zone", async () => {
		const system = createFeatureSystem({
			shellDelegates: createTestShellDelegates(),
			features: [],
		});
		const { baseElement } = render(
			<SdkProvider system={system}>
				<Probe zone="chat-right-panel" />
			</SdkProvider>,
		);
		const value = () => baseElement.querySelector("[data-testid='contributions']")?.textContent;

		expect(value()).toBe("");
		const removeLow = system.getSdk("low-plugin").contribute("chat-right-panel", {
			id: "low",
			component: null,
			label: "Low",
			priority: 1,
		});
		system.getSdk("high-plugin").contribute("chat-right-panel", {
			id: "high",
			component: null,
			label: "High",
			priority: 10,
		});

		await expect.poll(value).toBe("high,low");
		removeLow();
		await expect.poll(value).toBe("high");
	});
});

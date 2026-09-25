import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShellDelegates, TelemetryData } from "@kilo-desktop/feature-sdk";

import { createFeatureSystem, SdkProvider } from "./SdkProvider.js";
import { createTestShellDelegates } from "./test-helpers.js";
import { useTelemetry } from "./useTelemetry.js";

function delegatesWithTelemetry(telemetry: ShellDelegates["telemetry"]): ShellDelegates {
	return { ...createTestShellDelegates(), telemetry };
}

function Probe({ input }: { input: TelemetryData }) {
	const { track } = useTelemetry();
	return (
		<button type="button" data-testid="track" onClick={() => void track(input)}>
			track
		</button>
	);
}

describe("useTelemetry", () => {
	afterEach(cleanup);

	it("forwards track input to the shell telemetry delegate", () => {
		const track = vi.fn(async () => {});
		const input: TelemetryData = { event: "Page Visit", data: { path: "/x" } };
		const system = createFeatureSystem({
			shellDelegates: delegatesWithTelemetry({ track }),
			features: [],
		});

		const { baseElement } = render(
			<SdkProvider system={system}>
				<Probe input={input} />
			</SdkProvider>,
		);
		baseElement.querySelector<HTMLButtonElement>('[data-testid="track"]')?.click();

		expect(track).toHaveBeenCalledWith(input);
	});
});

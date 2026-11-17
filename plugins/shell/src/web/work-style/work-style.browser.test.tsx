import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	definePlugin,
	KernelDataCollection,
	KernelError,
	KernelTelemetrySink,
	type DomainObjectProvider,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	KiloWorkStyle,
	type WorkStyle,
} from "@kilo-desktop/plugin-core/contracts";

import shellManifest from "../../../plugin.json";
import {
	OnboardingStep,
	SHELL_DEFINITIONS,
	type OnboardingStepImplementation,
	type OnboardingStepView,
} from "../../contracts";
import { activateWorkStyleStep } from "./index";

let host: PluginHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

interface BootOptions {
	/** What `conflicts` reports. */
	readonly conflicts?: string[];
	/** Leaves kilo.core/work-style unprovided. */
	readonly withoutWorkStyle?: boolean;
}

/** Stands in for kilo.core's work style: records applies, and can fail the next one. */
function fakeCore(options: BootOptions) {
	const applied: WorkStyle[] = [];
	const failures: Error[] = [];
	const main = definePlugin({
		activate(sdk) {
			if (options.withoutWorkStyle) return;
			const workStyle: DomainObjectProvider<typeof KiloWorkStyle> = sdk.domainObjects.provide(
				KiloWorkStyle,
				{
					initialState: { style: null },
					methods: {
						conflicts: () => ({ keys: options.conflicts ?? [] }),
						apply: ({ style }) => {
							const failure = failures.shift();
							if (failure) throw failure;
							applied.push(style);
							workStyle.setState({ style });
						},
					},
				},
			);
		},
	});
	return { main, applied, failNext: (error: Error) => failures.push(error) };
}

/** A telemetry sink, so the test sees what the step reports. */
function telemetrySink() {
	const delivered: Pick<TelemetryEnvelope, "key" | "name" | "data">[] = [];
	const plugin = {
		manifest: testManifest("test.sink", {
			contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } },
		}),
		main: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(KernelTelemetrySink, "sink", {
					deliver: ({ key, name, data }) => void delivered.push({ key, name, data }),
				});
			},
		}),
	};
	return { delivered, plugin };
}

/** Draws the step the way the onboarding host does: heading, body, aside and Continue. */
function drawStep(view: OnboardingStepView) {
	return (
		<div>
			<h2>{view.title}</h2>
			{view.body}
			{view.aside}
			<button
				type="button"
				disabled={view.primary?.disabled}
				onClick={view.primary?.onClick}
				data-qa-id="onboarding-continue"
			>
				{view.primary?.label}
			</button>
		</div>
	);
}

const selectStep = (step: OnboardingStepImplementation) => step.Step;

async function openWorkStyleStep(options: BootOptions = {}) {
	const core = fakeCore(options);
	const sink = telemetrySink();
	host = await createPluginHost(
		[
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS, main: core.main },
			{
				manifest: shellManifest,
				definitions: SHELL_DEFINITIONS,
				web: definePlugin({ activate: activateWorkStyleStep }),
			},
			sink.plugin,
		],
		{ host: { desktop: true } },
	);
	host.main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: true, allowed: true, installationId: "i", environment: "stable" },
		methods: { setChoice: () => {} },
	});
	const next = vi.fn();
	const slot = host.renderSlot(
		OnboardingStep,
		{ next, children: drawStep },
		{ select: selectStep },
	);
	await expect
		.element(page.getByRole("heading", { name: "Choose how you want to work" }))
		.toBeVisible();
	return { ...core, next, delivered: sink.delivered, slot };
}

const choice = (style: string) => page.getByTestId(`onboarding-work-style-${style}`);
const radio = (style: string) => choice(style).getByRole("radio");
const reported = (delivered: { name: string; data: unknown }[]) =>
	delivered.map(({ name, data }) => [name, data]);

describe("work-style onboarding telemetry", () => {
	it("reports the step once when shown, and each choice the person continues with", async () => {
		const { delivered, next, slot } = await openWorkStyleStep();
		await vi.waitFor(() =>
			expect(reported(delivered)).toEqual([["Work Style Onboarding Shown", {}]]),
		);

		await choice("human-in-the-loop").click();
		await page.getByTestId("onboarding-continue").click();
		await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());

		slot.unmount();
		host!.renderSlot(OnboardingStep, { next, children: drawStep }, { select: selectStep });
		await expect.element(page.getByTestId("onboarding-work-style-step")).toBeVisible();

		await vi.waitFor(() =>
			expect(reported(delivered)).toEqual([
				["Work Style Onboarding Shown", {}],
				["Work Style Selected", { style: "human-in-the-loop" }],
			]),
		);
	});
});

describe("work-style onboarding step", () => {
	it("starts on High autonomy and applies it on Continue", async () => {
		const { applied, next } = await openWorkStyleStep();

		await expect.element(radio("autonomous")).toBeChecked();
		await page.getByTestId("onboarding-continue").click();

		await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
		expect(applied).toEqual(["autonomous"]);
	});

	it("warns before Review first replaces the user's own rules, then applies it", async () => {
		const { applied, next } = await openWorkStyleStep({ conflicts: ["edit"] });

		await expect
			.element(page.getByTestId("onboarding-work-style-existing"))
			.not.toBeInTheDocument();
		await choice("human-in-the-loop").click();

		await expect.element(page.getByTestId("onboarding-work-style-existing")).toBeVisible();
		await page.getByTestId("onboarding-continue").click();
		await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
		expect(applied).toEqual(["human-in-the-loop"]);
	});

	it("explains a failed save and offers to retry", async () => {
		const { failNext, applied, next } = await openWorkStyleStep();
		failNext(new KernelError("BUSINESS", "Config is read-only."));
		await choice("human-in-the-loop").click();

		await page.getByTestId("onboarding-continue").click();

		await expect.element(page.getByText("Config is read-only.")).toBeVisible();
		await expect.element(page.getByTestId("onboarding-continue")).toHaveAccessibleName("Retry");
		expect(next).not.toHaveBeenCalled();

		await choice("autonomous").click();
		await expect.element(page.getByText("Config is read-only.")).not.toBeInTheDocument();
		await page.getByTestId("onboarding-continue").click();
		await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
		expect(applied).toEqual(["autonomous"]);
	});

	it("is not offered while kilo.core has no work style", async () => {
		const core = fakeCore({ withoutWorkStyle: true });
		host = await createPluginHost(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS, main: core.main },
				{
					manifest: shellManifest,
					definitions: SHELL_DEFINITIONS,
					web: definePlugin({ activate: activateWorkStyleStep }),
				},
			],
			{ host: { desktop: true } },
		);

		const step = host.renderer.kernelSdk.extensions
			.list(OnboardingStep)
			.find((contribution) => contribution.key === "kilo.shell/work-style");
		expect(step?.implementation).toBeUndefined();
	});
});

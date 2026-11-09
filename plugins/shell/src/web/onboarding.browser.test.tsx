import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginRegistration, PluginSdk } from "@kilo-desktop/kernel";
import type { MainKernel } from "@kilo-desktop/kernel/main";

import { Onboarding, OnboardingStep, type OnboardingStepImplementation } from "../contracts";
import { contributor, renderShell } from "./test-support";

/** A required splash step, like accepting the terms, owning the key that lifts it. */
function termsStep(): PluginRegistration {
	let sdk: PluginSdk | undefined;
	const step: OnboardingStepImplementation = {
		useStep: ({ next }) => ({
			body: (
				<div className="flex flex-1 items-center justify-center">
					<button
						type="button"
						onClick={() => {
							sdk?.context.set("accepted", true);
							next();
						}}
					>
						I agree
					</button>
				</div>
			),
			primary: null,
		}),
	};
	return contributor(
		"acme.terms",
		{
			"kilo.shell/onboarding-step": [
				{
					id: "terms",
					label: "Terms",
					layout: "splash",
					priority: 1000,
					required: { none: ["acme.terms/accepted"] },
				},
			],
		},
		(pluginSdk) => {
			sdk = pluginSdk;
			pluginSdk.extensions.implement(OnboardingStep, "terms", step);
		},
		{ contextKeys: [{ id: "accepted", scope: "window" }] },
	);
}

/** Two card steps: one that can be skipped, then the last. */
function tourSteps(): PluginRegistration {
	return contributor(
		"acme.tour",
		{
			"kilo.shell/onboarding-step": [
				{ id: "connect", label: "Connect", priority: 500 },
				{ id: "finish", label: "Finish", priority: 400 },
			],
		},
		(sdk) => {
			sdk.extensions.implement(OnboardingStep, "connect", {
				useStep: () => ({
					title: "Connect your account",
					subtitle: "Or do it later.",
					body: <p>Connect body</p>,
					skippable: true,
				}),
			});
			sdk.extensions.implement(OnboardingStep, "finish", {
				useStep: ({ next }) => ({
					title: "Almost there",
					body: <p>Finish body</p>,
					primary: { label: "Next", onClick: next },
				}),
			});
		},
	);
}

async function renderOnboarding(
	plugins: readonly PluginRegistration[],
	options: { desktop?: boolean; finished?: boolean; beforeRender?: () => void } = {},
) {
	const host = await renderShell(plugins, {
		desktop: options.desktop ?? true,
		onboarding: true,
		beforeRender: (main: MainKernel) => {
			if (options.finished)
				void main.kernelSdk.domains.get(Onboarding)!.methods.complete(undefined);
			options.beforeRender?.();
		},
	});
	const outcome = () => host.main.kernelSdk.domains.get(Onboarding)!.getState().outcome;
	return { ...host, outcome };
}

const overlay = () => page.getByTestId("onboarding-overlay");

/** A step offered only while nothing is connected yet, owning that key. */
function connectStep(): PluginRegistration & { setConnected(value: boolean): void } {
	let sdk: PluginSdk | undefined;
	const registration = contributor(
		"acme.connect",
		{
			"kilo.shell/onboarding-step": [
				{
					id: "connect",
					label: "Connect",
					priority: 500,
					showWhen: { none: ["acme.connect/connected"] },
				},
			],
		},
		(pluginSdk) => {
			sdk = pluginSdk;
			pluginSdk.extensions.implement(OnboardingStep, "connect", {
				useStep: () => ({ title: "Connect something", body: <p>Connect body</p> }),
			});
		},
		{ contextKeys: [{ id: "connected", scope: "window" }] },
	);
	return { ...registration, setConnected: (value) => sdk?.context.set("connected", value) };
}

describe("onboarding", () => {
	it("walks through the steps in order and remembers completion", async () => {
		const { outcome } = await renderOnboarding([termsStep(), tourSteps()]);

		await expect.element(overlay()).toHaveAttribute("data-step", "acme.terms/terms");
		await page.getByRole("button", { name: "I agree" }).click();

		await expect.element(page.getByRole("heading", { name: "Connect your account" })).toBeVisible();
		expect(page.getByTestId("onboarding-progress-label").element().textContent).toBe("Step 1 of 3");
		await page.getByTestId("onboarding-continue").click();
		await expect.element(page.getByRole("heading", { name: "Almost there" })).toBeVisible();
		await page.getByTestId("onboarding-back").click();
		await expect.element(page.getByRole("heading", { name: "Connect your account" })).toBeVisible();
		await page.getByTestId("onboarding-skip").click();
		await page.getByRole("button", { name: "Next" }).click();

		// The shell's own closing step comes last.
		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
		await expect
			.element(page.getByText("Use any model from any provider", { exact: true }))
			.toBeVisible();
		await page.getByTestId("onboarding-continue").click();

		await expect.element(overlay()).not.toBeInTheDocument();
		await expect.poll(outcome).toBe("completed");
	});

	it("records leaving setup as skipped", async () => {
		const { outcome } = await renderOnboarding([tourSteps()]);

		await page.getByTestId("onboarding-exit").click();

		await expect.element(overlay()).not.toBeInTheDocument();
		await expect.poll(outcome).toBe("skipped");
	});

	it("stays closed once finished", async () => {
		await renderOnboarding([tourSteps()], { finished: true });

		await expect.element(page.getByTestId("app-sidebar")).toBeVisible();
		await expect.element(overlay()).not.toBeInTheDocument();
	});

	it("shows a required step even after onboarding is done, and can't be dismissed", async () => {
		await renderOnboarding([termsStep(), tourSteps()], { finished: true });

		await expect.element(overlay()).toHaveAttribute("data-step", "acme.terms/terms");
		await expect.element(page.getByTestId("onboarding-exit")).not.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await expect.element(overlay()).toBeVisible();

		await page.getByRole("button", { name: "I agree" }).click();

		// Onboarding was already done, so accepting closes it instead of replaying the tour.
		await expect.element(overlay()).not.toBeInTheDocument();
	});

	it("decides which conditional steps to offer when it opens, and keeps them", async () => {
		const connect = connectStep();
		await renderOnboarding([connect]);
		await expect.element(page.getByRole("heading", { name: "Connect something" })).toBeVisible();

		// Connecting mid-flow doesn't pull the step out from under the person.
		connect.setConnected(true);

		await expect.element(page.getByRole("heading", { name: "Connect something" })).toBeVisible();
		expect(page.getByTestId("onboarding-progress-label").element().textContent).toBe("Step 1 of 2");
	});

	it("leaves out a conditional step that doesn't apply when it opens", async () => {
		const connect = connectStep();
		await renderOnboarding([connect], {
			beforeRender: () => connect.setConnected(true),
		});

		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
		await expect
			.element(page.getByRole("heading", { name: "Connect something" }))
			.not.toBeInTheDocument();
	});

	it("is not shown in browser mode", async () => {
		await renderOnboarding([tourSteps()], { desktop: false });

		await expect.element(page.getByTestId("app-sidebar")).toBeVisible();
		await expect.element(overlay()).not.toBeInTheDocument();
	});
});

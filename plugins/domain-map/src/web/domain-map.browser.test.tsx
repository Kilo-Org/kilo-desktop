import { describe, expect, it } from "vitest";
import { page, type Locator } from "vitest/browser";

import { renderShell } from "@kilo-desktop/plugin-shell/testing";

import {
	developerFlag,
	domainMap,
	listener,
	openDomainMap,
	PANEL,
	ticker,
} from "../test/domain-map";

const logEntries = () => page.getByTestId("domain-map-log-entry");
const counts = () => page.getByTestId("domain-map-counts");

/**
 * Ticks once, after the map is following the clock, and waits for the log
 * to show it. Ticking once (not on a loop) lets the scene go idle again:
 * in a software-WebGL test browser, continuous animation starves the page.
 */
/**
 * Clicks a control while the scene draws. Playwright waits for two matching
 * animation frames before clicking, and software-rendered WebGL makes each
 * frame slow, so this clicks the element itself.
 */
function pick(locator: Locator) {
	(locator.element() as HTMLElement).click();
}

async function clockTicked(clock: ReturnType<typeof ticker>) {
	await expect.element(counts()).toMatchTextContent(/declared uses/);
	clock.tick();
	await expect
		.element(logEntries().filter({ hasText: "acme.ticker/clock · tick" }).first(), {
			timeout: 15_000,
		})
		.toBeVisible();
}

// Each test draws a WebGL scene, which is slow in a software-rendering test browser.
describe("the Domain Map", { timeout: 60_000 }, () => {
	it("is a panel in the shell's right sidebar, drawing the domain objects", async () => {
		await openDomainMap([ticker().plugin, listener]);

		await expect.element(page.getByTestId("right-sidebar")).toMatchTextContent("Domain Map");
		await expect.element(page.getByTestId("domain-map-canvas")).toBeVisible();
		await expect.element(counts()).toMatchTextContent(/[1-9]\d* domain objects/);
		await expect.element(page.getByTestId("domain-map-unsupported")).not.toBeInTheDocument();
	});

	it("is absent while the developer flag is off", async () => {
		await renderShell([developerFlag, domainMap, ticker().plugin]);
		await expect.element(page.getByTestId("shell-main")).toBeVisible();

		await expect.element(page.getByTestId(PANEL)).not.toBeInTheDocument();
	});

	it("draws a line from a domain object to each plugin declaring it uses it", async () => {
		await openDomainMap([ticker().plugin, listener]);

		await expect.element(counts()).toMatchTextContent(/[1-9]\d* declared uses/);
	});

	it("logs a domain object's events and state changes as they happen, with its declared users", async () => {
		const clock = ticker();
		await openDomainMap([clock.plugin, listener]);

		await clockTicked(clock);
		await expect
			.element(logEntries().filter({ hasText: "acme.ticker/clock · tick" }).first())
			.toMatchTextContent(/→ 1.*\{"ticks":\d+\}/);
		await expect
			.element(logEntries().filter({ hasText: "acme.ticker/clock · state" }).first())
			.toBeVisible();
	});

	it("shows who declares they use a domain object, picked from the log", async () => {
		const clock = ticker();
		await openDomainMap([clock.plugin, listener]);
		await clockTicked(clock);

		pick(logEntries().filter({ hasText: "acme.ticker/clock · tick" }).first());

		const selected = page.getByTestId("domain-map-selected");
		await expect.element(selected).toMatchTextContent("acme.ticker/clock");
		await expect.element(selected).toMatchTextContent("Ticks when told to.");
		await expect
			.element(page.getByTestId("domain-map-selected-users"))
			.toMatchTextContent("Used by (declared) acme.listener");
		// acme.listener runs only in the window, so it uses the clock through its mirror.
		await expect.element(page.getByTestId("domain-map-selected-mirror")).toBeVisible();

		await page.getByTestId("domain-map-deselect").click();
		await expect.element(selected).not.toBeInTheDocument();
	});

	it("stops logging while paused", async () => {
		const clock = ticker();
		await openDomainMap([clock.plugin, listener]);
		await page.getByTestId("domain-map-animate").click();

		clock.tick();
		await new Promise((resolve) => setTimeout(resolve, 400));

		await expect
			.element(logEntries().filter({ hasText: "acme.ticker/clock" }))
			.not.toBeInTheDocument();
	});

	it("hides extension points on request", async () => {
		await openDomainMap([ticker().plugin, listener]);
		await expect.element(counts()).toMatchTextContent(/extension points/);

		await page.getByTestId("domain-map-points").click();

		await expect.element(counts()).not.toMatchTextContent(/extension points/);
	});

	// Each switch rebuilds the 3D scene, which is slow in a software-WebGL test browser.
	it(
		"changes how the map is drawn from its switches, and resets the view",
		{ timeout: 90_000 },
		async () => {
			const clock = ticker();
			await openDomainMap([clock.plugin, listener]);

			// Rotating redraws every frame, which starves a software-WebGL test browser: on and straight off.
			await page.getByTestId("domain-map-rotate").click();
			await page.getByTestId("domain-map-rotate").click();
			await expect.element(page.getByTestId("domain-map-rotate")).not.toBeChecked();

			for (const id of ["only-active", "plugins", "unprovided", "state"]) {
				const toggle = page.getByTestId(`domain-map-${id}`);
				const before = (toggle.element() as HTMLElement).getAttribute("aria-checked");
				await toggle.click();
				await expect.element(toggle).not.toHaveAttribute("aria-checked", before ?? "");
			}
			clock.tick();
			await page.getByTestId("domain-map-reset").click();

			await expect.element(page.getByTestId("domain-map-canvas")).toBeVisible();
			await expect.element(counts()).toMatchTextContent(/domain objects/);
		},
	);
});

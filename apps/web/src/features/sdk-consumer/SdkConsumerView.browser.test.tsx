import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";
import { createSdk } from "@anaconda-agentic-desktop/feature-sdk";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";

import { SdkConsumerView } from "./SdkConsumerView";

function makeSharedSystem() {
	const producer = createFakeSdk({ featureId: "sdk-producer" });
	const clickCount = producer.state.register("click-count", 7);
	producer.plugins.expose("explorerService", {
		getInfo: () => ({ name: "sdk-producer", version: "2.0.0" }),
	});
	const consumer = createSdk("sdk-consumer", producer.services);
	const system = createFakeFeatureSystem({
		sdks: { "sdk-producer": producer, "sdk-consumer": consumer },
	});
	return { system, producer, clickCount };
}

afterEach(() => {
	cleanup();
});

describe("SdkConsumerView", () => {
	it("subscribes to producer state and peeks on demand", async () => {
		const { system, clickCount } = makeSharedSystem();
		const { baseElement } = render(
			<SdkProvider system={system}>
				<SdkConsumerView />
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("sdk-consumer-heading")).toBeVisible();
		await expect.element(screen.getByText("7")).toBeVisible();

		await screen.getByTestId("sdk-consumer-peek").click();
		await expect.element(screen.getByText(/7 \(has: true\)/)).toBeVisible();

		clickCount.set(8);
		await expect.element(screen.getByText("8")).toBeVisible();
	});

	it("shows capability result and null when missing", async () => {
		const producer = createFakeSdk({ featureId: "sdk-producer" });
		const consumer = createSdk("sdk-consumer", producer.services);
		const system = createFakeFeatureSystem({
			sdks: { "sdk-producer": producer, "sdk-consumer": consumer },
		});

		const { baseElement } = render(
			<SdkProvider system={system}>
				<SdkConsumerView />
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("sdk-consumer-capability").click();
		await expect
			.element(screen.getByText(/null — sdk-producer has not exposed capabilities yet/))
			.toBeVisible();

		producer.plugins.expose("explorerService", {
			getInfo: () => ({ name: "sdk-producer", version: "9.9.9" }),
		});
		await screen.getByTestId("sdk-consumer-capability").click();
		await expect.element(screen.getByText(/9\.9\.9/)).toBeVisible();
	});

	it("lists cross-feature note-added events", async () => {
		const { system, producer } = makeSharedSystem();
		const { baseElement } = render(
			<SdkProvider system={system}>
				<SdkConsumerView />
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/No events yet/)).toBeVisible();
		producer.events.emit("note-added", { id: "abcdef12-xxxx", text: "hello" });
		await expect.element(screen.getByText(/note-added: id=abcdef12/)).toBeVisible();
		await expect.element(screen.getByText(/text="hello"/)).toBeVisible();
	});
});

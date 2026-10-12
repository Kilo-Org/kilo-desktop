import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { NotificationSettings } from "./NotificationSettings.js";
import {
	NOTIFICATION_PREFERENCES_STORAGE_KEY,
	useNotificationPreferences,
} from "./notification-preferences.js";

const modeSelect = (name: string) => page.getByRole("combobox", { name });
const selectedLabel = (name: string) => () => modeSelect(name).element().textContent ?? "";

describe("NotificationSettings", () => {
	beforeEach(() => {
		useNotificationPreferences.setState({ done: "smart", needsYou: "smart" });
	});
	afterEach(() => {
		cleanup();
		localStorage.removeItem(NOTIFICATION_PREFERENCES_STORAGE_KEY);
	});

	it("sets each cue independently and saves it to local storage", async () => {
		render(<NotificationSettings />);
		await expect.poll(selectedLabel("When a chat finishes")).toContain("When I'm not looking");
		await expect.poll(selectedLabel("When Kilo needs you")).toContain("When I'm not looking");

		await modeSelect("When a chat finishes").click();
		await page.getByRole("option", { name: "Never" }).click();
		await modeSelect("When Kilo needs you").click();
		await page.getByRole("option", { name: "Always" }).click();

		await expect.poll(selectedLabel("When a chat finishes")).toContain("Never");
		await expect.poll(selectedLabel("When Kilo needs you")).toContain("Always");
		const stored = JSON.parse(localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}");
		expect(stored.state).toMatchObject({ done: "off", needsYou: "always" });
	});
});

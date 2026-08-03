import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";
import { sdkProducerContract, type Note } from "@anaconda-agentic-desktop/contracts";

import { SdkProvider } from "@/platform/sdk";

import { SdkProducerView } from "./SdkProducerView";

function makeNotesStore() {
	let notes: Note[] = [];
	return {
		list: () => [...notes],
		add: (input: { text: string }) => {
			const note: Note = { id: crypto.randomUUID(), text: input.text, createdAt: Date.now() };
			notes.push(note);
			return note;
		},
		delete: (input: { id: string }) => {
			const before = notes.length;
			notes = notes.filter((n) => n.id !== input.id);
			return { deleted: notes.length < before };
		},
		clear: () => {
			const count = notes.length;
			notes = [];
			return { count };
		},
		echo: (input: { message: string }) => ({
			echoed: `[sdk-producer] ${input.message}`,
			timestamp: Date.now(),
		}),
	};
}

function makeSystem(options?: {
	notifications?: {
		show: () => { delivered: boolean; reason?: string };
		setBadge: () => { delivered: boolean; reason?: string };
	};
	fs?: {
		exists: (path: string) => Promise<boolean>;
	};
}) {
	const sdk = createFakeSdk({
		featureId: "sdk-producer",
		channels: sdkProducerContract,
		handlers: makeNotesStore(),
		...(options?.notifications ? { notifications: options.notifications } : {}),
		...(options?.fs ? { fs: options.fs } : {}),
	});
	const system = createFakeFeatureSystem({ sdks: { "sdk-producer": sdk } });
	return { system, sdk };
}

function renderProducer(options?: Parameters<typeof makeSystem>[0]) {
	const { system, sdk } = makeSystem(options);
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const result = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={qc}>
				<SdkProducerView />
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { ...result, system, sdk };
}

afterEach(() => {
	cleanup();
});

describe("SdkProducerView", () => {
	it("adds, deletes, and clears notes through sdk.client", async () => {
		const { baseElement } = renderProducer();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("No notes yet.")).toBeVisible();
		await screen.getByTestId("note-input").fill("First note");
		await screen.getByTestId("note-add").click();
		await expect.element(screen.getByTestId("note-item").getByText("First note")).toBeVisible();

		await screen.getByRole("button", { name: "delete" }).click();
		await expect.element(screen.getByText("No notes yet.")).toBeVisible();

		await screen.getByTestId("note-input").fill("Again");
		await screen.getByTestId("note-add").click();
		await expect.element(screen.getByTestId("note-item").getByText("Again")).toBeVisible();
		await screen.getByRole("button", { name: "Clear All" }).click();
		await expect.element(screen.getByText("No notes yet.")).toBeVisible();
	});

	it("exercises SDK API action buttons", async () => {
		const { baseElement, sdk } = renderProducer({
			notifications: {
				show: () => ({ delivered: false, reason: "test undelivered" }),
				setBadge: () => ({ delivered: false, reason: "badge undelivered" }),
			},
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: /state\.set/ }).click();
		await expect.element(screen.getByText(/state\.set\("click-count", 1\)/)).toBeVisible();

		await screen.getByRole("button", { name: "client.echo" }).click();
		await expect.element(screen.getByText(/client\.echo\(\)/)).toBeVisible();

		await screen.getByRole("button", { name: "plugins.get" }).click();
		await expect.element(screen.getByText(/plugins\.get<T>\("sdk-producer"\)/)).toBeVisible();

		const originalGet = sdk.plugins.get.bind(sdk.plugins);
		sdk.plugins.get = (() => null) as typeof sdk.plugins.get;
		await screen.getByRole("button", { name: "plugins.get" }).click();
		await expect.element(screen.getByText(/plugins\.get returned null/)).toBeVisible();
		sdk.plugins.get = originalGet;

		await screen.getByRole("button", { name: "notifications.show" }).click();
		await expect
			.element(
				screen.getByText(/notifications\.show\(\) → delivered: false, reason: test undelivered/),
			)
			.toBeVisible();

		await screen.getByRole("button", { name: "notifications.setBadge" }).click();
		await expect
			.element(
				screen.getByText(
					/notifications\.setBadge\(\) → delivered: false, reason: badge undelivered/,
				),
			)
			.toBeVisible();

		await screen.getByRole("button", { name: "shell.copyText" }).click();
		await expect.element(screen.getByText(/shell\.copyText\(\) succeeded/)).toBeVisible();

		await screen.getByRole("button", { name: "shell.openExternal" }).click();
		await expect.element(screen.getByText(/shell\.openExternal\(\) →/)).toBeVisible();

		await screen.getByRole("button", { name: "fs.exists (expect fail)" }).click();
		await expect.element(screen.getByText(/fs\.exists\(\) FAILED/)).toBeVisible();

		await screen.getByRole("button", { name: "deferred APIs (expect throws)" }).click();
		await expect.element(screen.getByText(/Deferred APIs \(all expected to throw\)/)).toBeVisible();

		const clearCmd = sdk.services.commandRegistry
			.all()
			.find((c) => c.id === "sdk-producer.clear-notes");
		const logCmd = sdk.services.commandRegistry
			.all()
			.find((c) => c.id === "sdk-producer.log-state");
		expect(clearCmd).toBeDefined();
		expect(logCmd).toBeDefined();
		clearCmd?.handler();
		logCmd?.handler();
		await expect.element(screen.getByText(/Command executed: clear-notes/)).toBeVisible();
		await expect.element(screen.getByText(/Command executed: log-state/)).toBeVisible();
	});

	it("ignores blank note submissions", async () => {
		const { baseElement } = renderProducer();
		const screen = page.elementLocator(baseElement);
		await screen.getByTestId("note-input").fill("   ");
		await expect.element(screen.getByTestId("note-add")).toBeDisabled();
		const form = baseElement.querySelector("form");
		form?.requestSubmit();
		await expect.element(screen.getByText("No notes yet.")).toBeVisible();
	});

	it("logs successful notification delivery and filesystem checks", async () => {
		const { baseElement } = renderProducer({
			notifications: {
				show: () => ({ delivered: true }),
				setBadge: () => ({ delivered: true }),
			},
			fs: { exists: async () => true },
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "notifications.show" }).click();
		await expect
			.element(screen.getByText("notifications.show() → delivered: true", { exact: false }))
			.toBeVisible();

		await screen.getByRole("button", { name: "notifications.setBadge" }).click();
		await expect
			.element(screen.getByText("notifications.setBadge() → delivered: true", { exact: false }))
			.toBeVisible();

		await screen.getByRole("button", { name: "fs.exists (expect fail)" }).click();
		await expect.element(screen.getByText("fs.exists() → true", { exact: false })).toBeVisible();
	});
});

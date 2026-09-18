import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import { defineMethod, FeatureError, type MainSdk, type SDK } from "@kilo-desktop/feature-sdk";

import { createFeatureSystem } from "./SdkProvider.js";
import { createTestShellDelegates } from "./test-helpers.js";
import { sdkQueryKey, useSdkQuery } from "./useSdkQuery.js";
import { useSdkMutation } from "./useSdkMutation.js";

const itemSchema = z.object({ id: z.string(), label: z.string() });
type Item = z.infer<typeof itemSchema>;

const demoContract = {
	list: defineMethod(z.undefined(), z.array(itemSchema)),
	get: defineMethod(z.object({ id: z.string() }), itemSchema),
	add: defineMethod(z.object({ label: z.string().min(1) }), itemSchema),
	clear: defineMethod(z.undefined(), z.object({ count: z.number() })),
} as const;

interface DemoService {
	list(): Promise<Item[]>;
	get(args: { id: string }): Promise<Item>;
	add(args: { label: string }): Promise<Item>;
	clear(): Promise<{ count: number }>;
	[key: string]: (...args: never[]) => Promise<unknown>;
}

function makeDemoSdk(seed: readonly Item[] = []): SDK<DemoService> {
	let items: Item[] = [...seed];
	let nextId = seed.length + 1;

	function browserRegister(mainSdk: MainSdk): void {
		mainSdk.channels(demoContract).handleAll({
			list: () => [...items],
			get: ({ id }) => {
				const item = items.find((candidate) => candidate.id === id);
				if (!item) throw new FeatureError("Item not found.", "NOT_FOUND");
				return item;
			},
			add: ({ label }) => {
				const item: Item = { id: String(nextId++), label };
				items.push(item);
				return item;
			},
			clear: () => {
				const count = items.length;
				items = [];
				return { count };
			},
		});
	}

	const system = createFeatureSystem({
		shellDelegates: createTestShellDelegates(),
		features: [{ id: "demo", mainRegister: browserRegister, browserRegister }],
	});
	return system.getSdk("demo") as SDK<DemoService>;
}

function testClient(): QueryClient {
	return new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
}

function ListView({ sdk }: { readonly sdk: SDK<DemoService> }) {
	const items = useSdkQuery(sdk, "list");
	const add = useSdkMutation(sdk, "add", { invalidates: ["list"] });
	const addStale = useSdkMutation(sdk, "add");
	const clear = useSdkMutation(sdk, "clear", { invalidates: ["list"] });
	const [label, setLabel] = useState("");
	const mutationError = add.error ?? clear.error;

	return (
		<div>
			{items.isPending ? <p>Loading items…</p> : null}
			{items.isError ? <p role="alert">list error: {items.error.message}</p> : null}
			<ul aria-label="Items">
				{items.data?.map((item) => (
					<li key={item.id}>{item.label}</li>
				))}
			</ul>
			{mutationError ? <p role="alert">mutation error: {mutationError.message}</p> : null}
			<input aria-label="Label" value={label} onChange={(event) => setLabel(event.target.value)} />
			<button type="button" onClick={() => add.mutate({ label })}>
				Add
			</button>
			<button type="button" onClick={() => addStale.mutate({ label })}>
				Add stale
			</button>
			<button type="button" onClick={() => clear.mutate()}>
				Clear
			</button>
		</div>
	);
}

function GetView({ sdk, id }: { readonly sdk: SDK<DemoService>; readonly id: string }) {
	const item = useSdkQuery(sdk, "get", { id });
	if (item.isPending) return <p>Loading item…</p>;
	if (item.isError) return <p role="alert">get error: {item.error.message}</p>;
	return <output>{item.data.label}</output>;
}

function renderWithClient(ui: React.ReactElement) {
	return render(<QueryClientProvider client={testClient()}>{ui}</QueryClientProvider>);
}

afterEach(() => {
	cleanup();
});

describe("sdkQueryKey", () => {
	it("keys the cache by featureId, channel, and args", () => {
		const sdk = makeDemoSdk();
		expect(sdkQueryKey(sdk, "list")).toEqual(["demo", "list"]);
		expect(sdkQueryKey(sdk, "get", { id: "7" })).toEqual(["demo", "get", { id: "7" }]);
	});
});

describe("useSdkQuery", () => {
	it("loads data from the feature backend", async () => {
		const sdk = makeDemoSdk([{ id: "1", label: "First" }]);
		const { baseElement } = renderWithClient(<ListView sdk={sdk} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("First")).toBeVisible();
	});

	it("caches by args — different args resolve independently", async () => {
		const sdk = makeDemoSdk([
			{ id: "1", label: "One" },
			{ id: "2", label: "Two" },
		]);
		const { baseElement } = renderWithClient(
			<div>
				<GetView sdk={sdk} id="1" />
				<GetView sdk={sdk} id="2" />
			</div>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("One")).toBeVisible();
		await expect.element(screen.getByText("Two")).toBeVisible();
	});

	it("surfaces backend errors", async () => {
		const sdk = makeDemoSdk();
		const { baseElement } = renderWithClient(<GetView sdk={sdk} id="missing" />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/get error: Item not found\./)).toBeVisible();
	});
});

describe("useSdkMutation", () => {
	it("mutates and invalidates the configured channels", async () => {
		const sdk = makeDemoSdk();
		const { baseElement } = renderWithClient(<ListView sdk={sdk} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("list", { name: "Items" })).toBeInTheDocument();
		await screen.getByRole("textbox", { name: "Label" }).fill("Fresh");
		await screen.getByRole("button", { name: "Add", exact: true }).click();

		await expect.element(screen.getByText("Fresh")).toBeVisible();
	});

	it("does not invalidate anything without an invalidates config", async () => {
		const sdk = makeDemoSdk([{ id: "1", label: "Existing" }]);
		const { baseElement } = renderWithClient(<ListView sdk={sdk} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Existing")).toBeVisible();
		await screen.getByRole("textbox", { name: "Label" }).fill("Hidden");
		await screen.getByRole("button", { name: "Add stale" }).click();

		// The backend accepted the write, but the cached list was not refetched.
		await expect.element(screen.getByText("Existing")).toBeVisible();
		await expect.element(screen.getByText("Hidden")).not.toBeInTheDocument();
	});

	it("supports zero-argument channels via mutate()", async () => {
		const sdk = makeDemoSdk([{ id: "1", label: "Doomed" }]);
		const { baseElement } = renderWithClient(<ListView sdk={sdk} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Doomed")).toBeVisible();
		await screen.getByRole("button", { name: "Clear" }).click();
		await expect.element(screen.getByText("Doomed")).not.toBeInTheDocument();
	});

	it("surfaces mutation errors", async () => {
		const sdk = makeDemoSdk();
		const { baseElement } = renderWithClient(<ListView sdk={sdk} />);
		const screen = page.elementLocator(baseElement);

		// Empty label fails contract validation at the routing boundary.
		await screen.getByRole("button", { name: "Add", exact: true }).click();
		await expect.element(screen.getByText(/mutation error: Invalid input/)).toBeVisible();
	});
});

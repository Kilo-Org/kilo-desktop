import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { defineMethod } from "./channel-map.js";
import { FeatureError } from "./errors.js";
import { createSdk } from "./services/create-sdk.js";
import type { ShellDelegates } from "./services/create-sdk.js";
import { CapabilityRegistry } from "./services/capability-registry.js";
import { CommandRegistry } from "./services/command-registry.js";
import { ContributionRegistry } from "./services/contribution-registry.js";
import { EventBus } from "./services/event-bus.js";
import { FeatureRouter } from "./services/feature-router.js";
import { StateBroker } from "./services/state-broker.js";

const todoSchema = z.object({
	id: z.string(),
	title: z.string(),
	completed: z.boolean(),
});

type Todo = z.infer<typeof todoSchema>;

const todosChannels = {
	list: defineMethod(z.undefined(), z.array(todoSchema)),
	add: defineMethod(z.object({ title: z.string().trim().min(1).max(120) }), todoSchema),
	toggle: defineMethod(z.object({ id: z.string().min(1) }), todoSchema),
} as const;

const transformedChannels = {
	length: defineMethod(
		z.string().transform((value) => Number(value)),
		z.string().transform((value) => value.length),
	),
} as const;

type TodoService = {
	list(): Promise<Todo[]>;
	add(args: { title: string }): Promise<Todo>;
	toggle(args: { id: string }): Promise<Todo>;
};

const noop = () => {};

function makeServices(featureRouter = new FeatureRouter()) {
	const shellDelegates: ShellDelegates = {
		notifications: {
			show: () => ({ delivered: true }),
			setBadge: () => ({ delivered: true }),
		},
		theme: {
			subscribe: (fn) => {
				fn("light");
				return noop;
			},
			peek: () => "light",
		},
		shell: { openExternal: async () => ({ opened: true }), copyText: async () => undefined },
		fs: {
			readFile: async () => "",
			writeFile: async () => undefined,
			exists: async () => false,
			mkdir: async () => undefined,
			readdir: async () => [],
			remove: async () => undefined,
		},
	};

	return {
		eventBus: new EventBus(),
		stateBroker: new StateBroker(),
		capabilityRegistry: new CapabilityRegistry(),
		contributionRegistry: new ContributionRegistry(),
		commandRegistry: new CommandRegistry(),
		featureRouter,
		shellDelegates,
	};
}

describe("defineMethod + sdk.client", () => {
	it("invokes handlers through sdk.client", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");
		const items: Todo[] = [{ id: "1", title: "Milk", completed: false }];

		const api = mainSdk.channels(todosChannels);
		api.handle("list", () => items);
		api.handle("add", ({ title }) => ({
			id: "2",
			title,
			completed: false,
		}));

		const sdk = createSdk("todos", services);
		const client = sdk.client as unknown as TodoService;

		const listed = await client.list();
		expect(listed).toEqual(items);
		expectTypeOf(listed).toEqualTypeOf<Todo[]>();

		const created = await client.add({ title: "Eggs" });
		expect(created).toEqual({ id: "2", title: "Eggs", completed: false });
		expectTypeOf(created).toEqualTypeOf<Todo>();

		// sdk.invoke still works untyped
		await expect(sdk.invoke("list")).resolves.toEqual(items);
	});

	it("distinguishes raw wire values from parsed handler values", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("transformed");

		mainSdk.channels(transformedChannels).handle("length", (value) => {
			expectTypeOf(value).toEqualTypeOf<number>();
			return String(value * 2);
		});

		const sdk = createSdk("transformed", services);
		const length = await sdk.invoke("length", "21");

		expect(length).toBe(2);

		if (import.meta.url === "") {
			// @ts-expect-error handler returns the output schema's raw input
			mainSdk.channels(transformedChannels).handle("length", () => 42);
		}
	});

	it("handleAll registers every channel in the map", async () => {
		const services = makeServices();
		const mainSdk = services.featureRouter.createMainSdk("todos");

		mainSdk.channels(todosChannels).handleAll({
			list: () => [],
			add: ({ title }) => ({ id: "1", title, completed: false }),
			toggle: ({ id }) => ({ id, title: "Milk", completed: true }),
		});

		expect(services.featureRouter.has("todos", "list")).toBe(true);
		expect(services.featureRouter.has("todos", "add")).toBe(true);
		expect(services.featureRouter.has("todos", "toggle")).toBe(true);

		const sdk = createSdk("todos", services);
		const client = sdk.client as unknown as TodoService;
		await expect(client.toggle({ id: "7" })).resolves.toEqual({
			id: "7",
			title: "Milk",
			completed: true,
		});

		if (import.meta.url === "") {
			// @ts-expect-error handleAll requires a handler for every channel in the map
			mainSdk.channels(todosChannels).handleAll({ list: () => [] });
			mainSdk.channels(todosChannels).handleAll({
				list: () => [],
				add: ({ title }) => ({ id: "1", title, completed: false }),
				toggle: ({ id }) => ({ id, title: "Milk", completed: true }),
				// @ts-expect-error handleAll rejects channels missing from the map
				extra: () => null,
			});
		}
	});

	it("treats invalid handler output as an internal error", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("todos");
		mainSdk.channels(todosChannels).handle("list", () => [{ id: 1 }] as never);

		const error = await router.invoke("todos", "list").catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(FeatureError);
		expect(error).toMatchObject({
			message: 'Handler for "todos:list" returned invalid output.',
		});
	});

	it("rejects invalid input at the router boundary", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("todos");
		mainSdk.channels(todosChannels).handle("add", ({ title }) => ({
			id: "9",
			title,
			completed: true,
		}));

		await expect(router.invoke("todos", "add", { title: 42 })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
	});
});

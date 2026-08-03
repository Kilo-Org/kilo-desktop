import { describe, expect, it, vi } from "vitest";

import { createInertNavigation, createRouterNavigation, type ShellRouterLike } from "./navigation";

function makeFakeRouter(initialPath = "/") {
	const handlers = new Set<() => void>();
	const router: ShellRouterLike = {
		state: { location: { pathname: initialPath, search: {} } },
		navigate: vi.fn(async (options) => {
			router.state.location.pathname = options.to;
			router.state.location.search = options.search ?? {};
			for (const handler of handlers) handler();
		}),
		subscribe: (_event, handler) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
	};
	return { router, handlers };
}

describe("createRouterNavigation", () => {
	it("navigate forwards path, search, and replace to the router", () => {
		const { router } = makeFakeRouter();
		const navigation = createRouterNavigation(router);

		navigation.navigate("/plugins/todos");
		expect(router.navigate).toHaveBeenLastCalledWith({ to: "/plugins/todos" });

		navigation.navigate("/plugins/todos", { search: { filter: "open" }, replace: true });
		expect(router.navigate).toHaveBeenLastCalledWith({
			to: "/plugins/todos",
			search: { filter: "open" },
			replace: true,
		});
	});

	it("peek reflects the router's current location", () => {
		const { router } = makeFakeRouter("/sdk-producer");
		const navigation = createRouterNavigation(router);
		expect(navigation.peek()).toEqual({ path: "/sdk-producer", search: {} });
	});

	it("subscribe fires synchronously and after each resolved navigation", () => {
		const { router, handlers } = makeFakeRouter();
		const navigation = createRouterNavigation(router);

		const seen: Array<{ path: string; search: Record<string, unknown> }> = [];
		const unsub = navigation.subscribe((location) => seen.push(location));
		expect(seen).toEqual([{ path: "/", search: {} }]);

		navigation.navigate("/plugins/todos", { search: { filter: "open" } });
		expect(seen).toEqual([
			{ path: "/", search: {} },
			{ path: "/plugins/todos", search: { filter: "open" } },
		]);

		unsub();
		expect(handlers.size).toBe(0);
		navigation.navigate("/");
		expect(seen).toHaveLength(2);
	});
});

describe("createInertNavigation", () => {
	it("navigation is a warn-once no-op reporting the home location", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const navigation = createInertNavigation();

			navigation.navigate("/plugins/todos");
			navigation.navigate("/again");
			expect(warn).toHaveBeenCalledOnce();
			expect(warn.mock.calls[0]?.[0]).toContain("no shell router is wired");

			expect(navigation.peek()).toEqual({ path: "/", search: {} });
			const seen: unknown[] = [];
			const unsub = navigation.subscribe((location) => seen.push(location));
			expect(seen).toEqual([{ path: "/", search: {} }]);
			expect(() => unsub()).not.toThrow();
		} finally {
			warn.mockRestore();
		}
	});
});

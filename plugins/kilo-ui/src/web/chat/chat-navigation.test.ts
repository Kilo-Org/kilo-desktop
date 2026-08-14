import { describe, expect, it, vi } from "vitest";

import { CHAT_ROUTE_PATH, navigateToChat } from "./chat-navigation.js";

function makeNavigation(path: string) {
	const navigate = vi.fn();
	return {
		navigation: { location: { peek: () => ({ path }) }, navigate },
		navigate,
	};
}

describe("navigateToChat", () => {
	it("navigates to the chat route from an unrelated path", () => {
		const { navigation, navigate } = makeNavigation("/plugins/environments");

		navigateToChat(navigation);

		expect(navigate).toHaveBeenCalledWith(CHAT_ROUTE_PATH);
	});

	it("does not navigate when already on the chat route", () => {
		const { navigation, navigate } = makeNavigation(CHAT_ROUTE_PATH);

		navigateToChat(navigation);

		expect(navigate).not.toHaveBeenCalled();
	});

	it("does not navigate when already on a nested chat route", () => {
		const { navigation, navigate } = makeNavigation(`${CHAT_ROUTE_PATH}/history`);

		navigateToChat(navigation);

		expect(navigate).not.toHaveBeenCalled();
	});
});

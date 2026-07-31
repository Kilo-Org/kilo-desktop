import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createBrowserLocalApi } from "./browserLocalApi";
import { LocalApiProvider, useLocalApi } from "./LocalApiProvider";

afterEach(() => {
	cleanup();
});

describe("LocalApiProvider", () => {
	it("throws when useLocalApi is used outside the provider", () => {
		function Probe() {
			useLocalApi();
			return null;
		}
		expect(() => render(<Probe />)).toThrow(/must be used within LocalApiProvider/);
	});

	it("provides the api to descendants", () => {
		const api = createBrowserLocalApi();
		let seen: unknown;
		function Probe() {
			seen = useLocalApi();
			return null;
		}
		render(
			<LocalApiProvider api={api}>
				<Probe />
			</LocalApiProvider>,
		);
		expect(seen).toBe(api);
	});
});

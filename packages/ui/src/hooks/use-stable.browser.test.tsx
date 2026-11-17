import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useStableCallback, useStableValue } from "./use-stable.js";

afterEach(cleanup);

describe("useStableCallback", () => {
	it("keeps one function that calls the latest committed callback", () => {
		const seen: Array<() => string> = [];
		const called: string[] = [];
		function Probe({ label }: { label: string }) {
			const read = useStableCallback(() => label);
			seen.push(read);
			useEffect(() => {
				called.push(read());
			});
			return null;
		}

		const { rerender } = render(<Probe label="first" />);
		rerender(<Probe label="second" />);

		expect(new Set(seen).size).toBe(1);
		expect(called).toEqual(["first", "second"]);
	});
});

describe("useStableValue", () => {
	it("returns the previous value while the new one is equal by the given comparison", () => {
		const seen: (readonly string[])[] = [];
		const sameItems = (a: readonly string[], b: readonly string[]) =>
			a.length === b.length && a.every((item, index) => item === b[index]);
		function Probe({ items }: { items: readonly string[] }) {
			seen.push(useStableValue(items, sameItems));
			return null;
		}

		const first = ["a", "b"];
		const { rerender } = render(<Probe items={first} />);
		rerender(<Probe items={["a", "b"]} />);
		const changed = ["a", "c"];
		rerender(<Probe items={changed} />);

		expect(seen[0]).toBe(first);
		expect(seen[1]).toBe(first);
		expect(seen.at(-1)).toBe(changed);
	});
});

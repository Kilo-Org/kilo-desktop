import { cleanup, render } from "@testing-library/react";
import { useEffect, type RefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useLatestRef } from "./use-latest-ref.js";

afterEach(cleanup);

describe("useLatestRef", () => {
	it("keeps one ref whose value is the latest committed render's", () => {
		const seen: RefObject<string>[] = [];
		const readInEffect: string[] = [];
		function Probe({ value }: { value: string }) {
			const latest = useLatestRef(value);
			seen.push(latest);
			useEffect(() => {
				readInEffect.push(latest.current);
			});
			return null;
		}

		const { rerender } = render(<Probe value="first" />);
		rerender(<Probe value="second" />);

		expect(new Set(seen).size).toBe(1);
		expect(readInEffect).toEqual(["first", "second"]);
		expect(seen[0]?.current).toBe("second");
	});
});

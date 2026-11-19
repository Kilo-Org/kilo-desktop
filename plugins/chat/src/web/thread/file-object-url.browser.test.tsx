import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFileObjectUrl } from "./file-object-url";

function Preview({ file }: { file: File | undefined }) {
	const url = useFileObjectUrl(file);
	return <span>{url ?? "none"}</span>;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("useFileObjectUrl", () => {
	it("shares one URL per file across components and revokes it when the last leaves", () => {
		const revoke = vi.spyOn(URL, "revokeObjectURL");
		const file = new File(["x"], "x.png", { type: "image/png" });

		const first = render(<Preview file={file} />);
		const second = render(<Preview file={file} />);
		const url = first.container.textContent;
		expect(url).toMatch(/^blob:/);
		expect(second.container.textContent).toBe(url);

		first.unmount();
		expect(revoke).not.toHaveBeenCalledWith(url);
		second.unmount();
		expect(revoke).toHaveBeenCalledWith(url);
	});

	it("drops the URL when the file goes away", () => {
		const revoke = vi.spyOn(URL, "revokeObjectURL");
		const file = new File(["y"], "y.png", { type: "image/png" });

		const view = render(<Preview file={file} />);
		const url = view.container.textContent;
		view.rerender(<Preview file={undefined} />);

		expect(view.container.textContent).toBe("none");
		expect(revoke).toHaveBeenCalledWith(url);
	});
});

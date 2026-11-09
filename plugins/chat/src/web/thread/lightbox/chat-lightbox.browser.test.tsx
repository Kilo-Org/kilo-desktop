import { cleanup, render } from "@testing-library/react";
import { useEffect, useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenMediaPaneContext, type OpenMediaPane } from "../../media/open-media-pane";
import { ChatLightboxProvider, useLightboxItem, type LightboxItemInput } from "./chat-lightbox";

afterEach(cleanup);

/** Opens its item in the same commit that registers it, before the provider re-renders. */
function OpensOnMount({ label }: { readonly label: string }) {
	const input = useMemo<LightboxItemInput>(
		() => ({ kind: "mermaid", code: "flowchart LR\n  A --> B", label }),
		[label],
	);
	const item = useLightboxItem(input);
	useEffect(() => {
		item.open();
	}, [item]);
	return <div ref={item.ref} />;
}

describe("the transcript's viewer registry", () => {
	it("opens an item clicked right after it registers in the pane", async () => {
		const openMediaPane = vi.fn<OpenMediaPane>(async () => true);
		render(
			<OpenMediaPaneContext.Provider value={openMediaPane}>
				<ChatLightboxProvider>
					<OpensOnMount label="Flowchart" />
				</ChatLightboxProvider>
			</OpenMediaPaneContext.Provider>,
		);

		await vi.waitFor(() => expect(openMediaPane).toHaveBeenCalled());
		const [items, itemId] = openMediaPane.mock.calls[0]!;
		expect(items.map((item) => item.id)).toContain(itemId);
		expect(document.querySelector('[data-qa-id="media-lightbox"]')).toBeNull();
	});
});

import type { LightboxItem } from "@kilo-desktop/ui/components/media-lightbox";

import type { MediaItem } from "../../contracts";
import { HtmlRenderFrame } from "../html-render/HtmlRenderFrame";
import type { ViewerItem } from "./open-media-pane";

/**
 * What the viewer shows for an item: images and diagrams as they are, a page
 * in its sandboxed frame, filling the viewer and scrolling inside.
 */
export function toLightboxItem(item: ViewerItem | MediaItem): LightboxItem {
	switch (item.kind) {
		case "page":
			return {
				kind: "custom",
				id: item.id,
				title: item.title,
				content: (
					<div className="h-full px-6 py-4" data-qa-id="chat-media-page">
						<HtmlRenderFrame key={item.id} html={item.html} title={item.title} fit="fill" />
					</div>
				),
			};
		case "mermaid":
			return { kind: "mermaid", id: item.id, code: item.code, label: item.label };
		case "image":
			return {
				kind: "image",
				id: item.id,
				src: item.src,
				...(item.alt ? { alt: item.alt } : {}),
				...(item.filename ? { filename: item.filename } : {}),
			};
	}
}

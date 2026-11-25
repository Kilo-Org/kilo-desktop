import type { PendingAttachment } from "@assistant-ui/react";
import { OpenCodeAttachmentAdapter } from "@kilo-desktop/react-opencode";

/**
 * OpenCode's attachments, each file read when it is added rather than when
 * it is sent. assistant-ui shows a send whose attachments still need
 * preparing in the transcript until the chat has it; a send the queue takes
 * would show there first. With nothing left to prepare, every send goes
 * straight to the runtime, attachments or not.
 */
export class KiloAttachmentAdapter extends OpenCodeAttachmentAdapter {
	override async add(state: { file: File }): Promise<PendingAttachment> {
		const attachment = await this.send(await super.add(state));
		// `add` is typed to return pending attachments, but assistant-ui reads
		// the status, and a complete one is ready to send as it is.
		return attachment as unknown as PendingAttachment;
	}
}

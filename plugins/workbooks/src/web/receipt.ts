/** A one-line summary of a workbook tool call, for its compact receipt in the chat. */
export function receiptText(
	toolName: string,
	args: Record<string, unknown>,
	isError?: boolean,
): string {
	const tool = toolName.replace(/^(desktop_workbooks_|kilo\.workbooks\/)/, "");
	const text = (value: unknown) => (typeof value === "string" ? value : "");
	const step = text(args.step);
	switch (tool) {
		case "read_workbook":
			return `${isError ? "Couldn't read" : "Read"} the workbook${args.section ? ` · ${text(args.section)}` : " Brief"}`;
		case "add_item":
			return isError
				? `Couldn't add to ${text(args.section)}`
				: `→ Added to ${text(args.section)}: ${text(args.text)}`;
		case "add_task":
			return isError
				? `Couldn't add a task to plan step ${step}`
				: `Added task to plan step ${step}: ${text(args.text)}`;
		case "set_task_done":
			if (isError) return `Couldn't update a task on plan step ${step}`;
			return args.done === false
				? `Unticked task on plan step ${step}: ${text(args.task)}`
				: `✓ Ticked task on plan step ${step}: ${text(args.task)}`;
		case "set_status": {
			const where = args.section
				? `${text(args.section)}: ${text(args.item)}`
				: `plan step ${text(args.item)}`;
			const status = text(args.status).replace("_", " ");
			if (isError) return `Couldn't update ${where}`;
			return status === "done" ? `✓ Ticked ${where}` : `${where} → ${status}`;
		}
		case "edit_step":
			return isError ? `Couldn't edit plan step ${step}` : `Edited plan step ${step}`;
		case "move_step": {
			const place = args.before ? `before ${text(args.before)}` : `after ${text(args.after)}`;
			return isError ? `Couldn't move plan step ${step}` : `Moved plan step ${step} ${place}`;
		}
		case "remove_item":
			return isError
				? `Couldn't remove from ${text(args.section)}`
				: `Removed from ${text(args.section)}: ${text(args.item)}`;
		case "supersede":
			return isError
				? `Couldn't supersede in ${text(args.section)}`
				: `Superseded in ${text(args.section)}: ${text(args.item)}`;
		case "answer_question":
			return isError
				? "Couldn't answer the question"
				: `Answered: ${text(args.question)}${args.recordIn ? ` → ${text(args.recordIn)}` : ""}`;
		case "write_section":
			return isError ? `Couldn't write ${text(args.section)}` : `Wrote ${text(args.section)}`;
		case "set_activity":
			if (isError) return "Couldn't update activity";
			return args.doing ? `Activity: ${text(args.doing)}` : "Cleared activity";
		case "hand_off":
			return isError ? "Couldn't update Where we left off" : "Updated Where we left off";
		default:
			return tool;
	}
}

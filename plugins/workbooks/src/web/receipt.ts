/** A one-line summary of a workbook tool call, for its compact receipt in the chat. */
export function receiptText(
	toolName: string,
	args: Record<string, unknown>,
	isError?: boolean,
): string {
	const tool = toolName.replace(/^(desktop_workbooks_|kilo\.workbooks\/)/, "");
	const text = (value: unknown) => (typeof value === "string" ? value : "");
	const verb = isError ? "Couldn't " : "";
	switch (tool) {
		case "read_workbook":
			return `${isError ? "Couldn't read" : "Read"} the workbook${args.section ? ` · ${text(args.section)}` : " Brief"}`;
		case "add_plan_step":
			return `${verb}${isError ? "add" : "Added"} plan step: ${text(args.title)}`;
		case "add_task":
			return isError
				? `Couldn't add a task to plan step ${text(args.step)}`
				: `Added task to plan step ${text(args.step)}: ${text(args.text)}`;
		case "set_task_done":
			if (isError) return `Couldn't update a task on plan step ${text(args.step)}`;
			return args.done === false
				? `Unticked task on plan step ${text(args.step)}: ${text(args.task)}`
				: `✓ Ticked task on plan step ${text(args.step)}: ${text(args.task)}`;
		case "set_step_status": {
			const status = text(args.status).replace("_", " ");
			if (isError) return `Couldn't update plan step ${text(args.step)}`;
			return status === "done"
				? `✓ Ticked plan step ${text(args.step)}`
				: `Plan step ${text(args.step)} → ${status}`;
		}
		case "record_decision":
			return isError ? "Couldn't record the decision" : `Recorded decision: ${text(args.decision)}`;
		case "file_item":
			return isError
				? `Couldn't file to ${text(args.section)}`
				: `→ Filed to ${text(args.section)}: ${text(args.text)}`;
		case "set_where_i_left_off":
			return isError ? "Couldn't update Where I left off" : "Updated Where I left off";
		default:
			return tool;
	}
}

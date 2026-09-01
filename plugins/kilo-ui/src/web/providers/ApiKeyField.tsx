import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@anaconda-agentic-desktop/ui/components/input-group";

export function ApiKeyField({
	id,
	value,
	invalid,
	qaId,
	placeholder,
	onChange,
}: {
	id: string;
	value: string;
	invalid?: boolean;
	qaId: string;
	placeholder?: string;
	onChange(value: string): void;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<InputGroup>
			<InputGroupInput
				id={id}
				type={visible ? "text" : "password"}
				autoComplete="off"
				aria-invalid={invalid || undefined}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				data-qa-id={qaId}
			/>
			<InputGroupAddon align="inline-end">
				<InputGroupButton
					size="icon-xs"
					aria-label={visible ? "Hide API key" : "Show API key"}
					aria-pressed={visible}
					data-qa-id={`${qaId}-visibility`}
					onClick={() => setVisible((current) => !current)}
				>
					{visible ? <EyeOffIcon /> : <EyeIcon />}
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	);
}

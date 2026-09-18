import { useEffect, useRef, useState } from "react";

import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { Switch } from "@kilo-desktop/ui/components/switch";

import type {
	LocalModelLoadMode,
	LocalServerSettings,
} from "../../shared/settings/server-settings.js";

type Draft = {
	port: string;
	modelLoadMode: LocalModelLoadMode;
	serveOnLocalNetwork: boolean;
};

type ParseResult = { ok: true; value?: number } | { ok: false; error: string };

const AUTOSAVE_DELAY_MS = 400;
const MODEL_LOAD_MODE_OPTIONS: { label: string; value: LocalModelLoadMode }[] = [
	{ label: "One model", value: "one" },
	{ label: "All models", value: "all" },
];

function draftFrom(settings: LocalServerSettings): Draft {
	return {
		port: settings.port === undefined ? "" : String(settings.port),
		modelLoadMode: settings.modelLoadMode ?? "one",
		serveOnLocalNetwork: Boolean(settings.serveOnLocalNetwork),
	};
}

function parseInteger(raw: string, min: number, max: number, error: string): ParseResult {
	const text = raw.trim();
	if (!text) return { ok: true };
	const value = Number(text);
	if (!Number.isInteger(value) || value < min || value > max) {
		return { ok: false, error };
	}
	return { ok: true, value };
}

export function ServerSettings({
	settings,
	disabled,
	error,
	onSave,
}: {
	settings: LocalServerSettings;
	disabled: boolean;
	error?: string | undefined;
	onSave: (settings: LocalServerSettings) => Promise<void>;
}) {
	const initial = draftFrom(settings);
	const [port, setPort] = useState(initial.port);
	const [modelLoadMode, setModelLoadMode] = useState(initial.modelLoadMode);
	const [serveOnLocalNetwork, setServeOnLocalNetwork] = useState(initial.serveOnLocalNetwork);
	const [localError, setLocalError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const onSaveRef = useRef(onSave);
	const settingsRef = useRef(settings);

	useEffect(() => {
		onSaveRef.current = onSave;
	}, [onSave]);

	useEffect(() => {
		settingsRef.current = settings;
	}, [settings]);

	useEffect(() => {
		if (!dirty) return;

		const timeout = setTimeout(() => {
			const parsedPort = parseInteger(
				port,
				1,
				65_535,
				"Server port must be an integer from 1 to 65535.",
			);
			if (!parsedPort.ok) {
				setLocalError(parsedPort.error);
				return;
			}
			const current = settingsRef.current;
			const next: LocalServerSettings = {
				...(parsedPort.value === undefined ? {} : { port: parsedPort.value }),
				...(modelLoadMode === "all" ? { modelLoadMode } : {}),
				...(serveOnLocalNetwork ? { serveOnLocalNetwork: true } : {}),
				...(current.llamaFlags === undefined ? {} : { llamaFlags: current.llamaFlags }),
			};
			const unchanged =
				next.port === current.port &&
				modelLoadMode === (current.modelLoadMode ?? "one") &&
				Boolean(next.serveOnLocalNetwork) === Boolean(current.serveOnLocalNetwork);

			setLocalError(null);
			setDirty(false);
			if (!unchanged) {
				void onSaveRef.current(next).catch(() => undefined);
			}
		}, AUTOSAVE_DELAY_MS);

		return () => clearTimeout(timeout);
	}, [dirty, modelLoadMode, port, serveOnLocalNetwork]);

	return (
		<FieldGroup className="gap-0">
			<Field orientation="horizontal" className="gap-6 p-4">
				<FieldContent>
					<FieldLabel className="text-sm" htmlFor="local-model-server-port">
						Server Port
					</FieldLabel>
					<FieldDescription className="text-xs">
						Leave blank to choose an available port automatically.
					</FieldDescription>
				</FieldContent>
				<Input
					id="local-model-server-port"
					type="number"
					inputMode="numeric"
					min={1}
					max={65_535}
					placeholder="Automatic"
					value={port}
					disabled={disabled}
					onChange={(event) => {
						setPort(event.target.value);
						setLocalError(null);
						setDirty(true);
					}}
					className="ml-auto h-8 w-36 shrink-0 text-sm"
					data-qa-id="local-model-server-port"
				/>
			</Field>
			<Field orientation="horizontal" className="border-border gap-6 border-t p-4">
				<FieldContent>
					<FieldLabel className="text-sm" htmlFor="local-model-server-load-mode">
						Models kept loaded
					</FieldLabel>
					<FieldDescription className="text-xs">
						Keep one model loaded to reduce memory use, or retain every model you use.
					</FieldDescription>
				</FieldContent>
				<Select
					items={MODEL_LOAD_MODE_OPTIONS}
					value={modelLoadMode}
					disabled={disabled}
					onValueChange={(value) => {
						if (value !== "one" && value !== "all") return;
						setModelLoadMode(value);
						setLocalError(null);
						setDirty(true);
					}}
				>
					<SelectTrigger
						id="local-model-server-load-mode"
						size="sm"
						className="ml-auto w-36 shrink-0"
						aria-label="Models kept loaded"
						data-qa-id="local-model-server-load-mode"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							<SelectItem value="one">One model</SelectItem>
							<SelectItem value="all">All models</SelectItem>
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
			<Field orientation="horizontal" className="border-border gap-6 border-t p-4">
				<FieldContent>
					<FieldLabel className="text-sm" htmlFor="local-model-server-lan">
						Serve on Local Network
					</FieldLabel>
					<FieldDescription className="text-xs">
						Allow trusted devices on your Wi-Fi or LAN to connect.
					</FieldDescription>
				</FieldContent>
				<Switch
					id="local-model-server-lan"
					className="ml-auto shrink-0 self-center"
					checked={serveOnLocalNetwork}
					disabled={disabled}
					onCheckedChange={(checked) => {
						setServeOnLocalNetwork(checked);
						setLocalError(null);
						setDirty(true);
					}}
					aria-label="Serve on Local Network"
					data-qa-id="local-model-server-lan"
				/>
			</Field>
			{localError || error ? (
				<FieldError className="px-4 pb-4 text-sm">{localError ?? error}</FieldError>
			) : null}
		</FieldGroup>
	);
}

import { InfoIcon, RotateCcwIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@kilo-desktop/ui/components/accordion";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@kilo-desktop/ui/components/field";
import { Slider } from "@kilo-desktop/ui/components/slider";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { Textarea } from "@kilo-desktop/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type { LocalModel, LocalModelSettings } from "../../contracts/schemas.js";
import {
	LLAMA_CPP_SAMPLING_DEFAULTS,
	parseLlamaFlags,
	serializeLlamaFlags,
	type LlamaOverridableModelSetting,
} from "../../shared/settings/model-settings.js";

const DEFAULT_CONTEXT_LENGTH = 4096;
const DEFAULT_MAX_RESPONSE_TOKENS = 4096;
const MIN_CONTEXT_EXPONENT = 8;
const MAX_CONTEXT_EXPONENT = 20;
const MIN_CONTEXT_LENGTH = 2 ** MIN_CONTEXT_EXPONENT;
const MAX_CONTEXT_LENGTH = 2 ** MAX_CONTEXT_EXPONENT;

function scalarSliderValue(value: number | readonly number[]): number {
	return typeof value === "number" ? value : (value[0] ?? 0);
}

function contextLengthFromExponent(exponent: number): number {
	return 2 ** Math.round(exponent);
}

function contextExponent(contextLength: number): number {
	return Math.log2(contextLength);
}

function formatTokenCount(value: number): string {
	return `${value.toLocaleString("en-US")} tokens`;
}

type NumericSettingSliderProps = {
	id: string;
	label: string;
	description: string;
	initialValue: number | undefined;
	fallbackValue: number;
	automaticLabel: string;
	min: number;
	max: number;
	step: number;
	inputAriaLabel: string;
	qaId: string;
	integer?: boolean;
	sliderMin?: number;
	sliderMax?: number;
	sliderStep?: number;
	settingFromSlider?: (value: number) => number;
	sliderFromSetting?: (value: number) => number;
	valueText?: (value: number) => string;
	onCommit: (value: number | undefined) => void;
};

function decimalPlaces(step: number): number {
	const decimal = String(step).split(".")[1];
	return decimal?.length ?? 0;
}

function NumericSettingSlider({
	id,
	label,
	description,
	initialValue,
	fallbackValue,
	automaticLabel,
	min,
	max,
	step,
	inputAriaLabel,
	qaId,
	integer = false,
	sliderMin = min,
	sliderMax = max,
	sliderStep = step,
	settingFromSlider = (value) => value,
	sliderFromSetting = (value) => value,
	valueText = (value) => String(value),
	onCommit,
}: NumericSettingSliderProps) {
	const precision = decimalPlaces(step);
	const formatInput = (value: number) =>
		integer ? String(value) : String(Number(value.toFixed(precision)));
	const [value, setValue] = useState(initialValue);
	const [inputValue, setInputValue] = useState(
		initialValue === undefined ? "" : formatInput(initialValue),
	);
	const effectiveValue = value ?? fallbackValue;

	const applySliderValue = (sliderValue: number) => {
		const next = settingFromSlider(sliderValue);
		setValue(next);
		setInputValue(formatInput(next));
		return next;
	};
	const commitInput = () => {
		if (inputValue.trim() === "") {
			setInputValue("");
			if (value !== undefined) {
				setValue(undefined);
				onCommit(undefined);
			}
			return;
		}
		const parsed = Number(inputValue);
		if (
			!Number.isFinite(parsed) ||
			(integer && !Number.isInteger(parsed)) ||
			parsed < min ||
			parsed > max
		) {
			setInputValue(value === undefined ? "" : formatInput(value));
			return;
		}
		const next = integer ? parsed : Number(parsed.toFixed(precision));
		setValue(next);
		setInputValue(formatInput(next));
		if (next !== value) onCommit(next);
	};

	return (
		<Field>
			<Slider
				id={id}
				label={<span className="text-sm">{label}</span>}
				labelAddon={
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="text-muted-foreground"
									aria-label={`About ${label}`}
								/>
							}
						>
							<InfoIcon />
						</TooltipTrigger>
						<TooltipContent>{description}</TooltipContent>
					</Tooltip>
				}
				inputAddon={
					value !== undefined ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="text-muted-foreground"
										aria-label={`Reset ${label} to automatic`}
										data-qa-id={`${qaId}-reset`}
										onClick={() => {
											setValue(undefined);
											setInputValue("");
											onCommit(undefined);
										}}
									/>
								}
							>
								<RotateCcwIcon />
							</TooltipTrigger>
							<TooltipContent>Use automatic value</TooltipContent>
						</Tooltip>
					) : null
				}
				min={sliderMin}
				max={sliderMax}
				step={sliderStep}
				value={sliderFromSetting(effectiveValue)}
				className="[&_[data-slot=slider-track]]:bg-foreground/15"
				aria-label={label}
				aria-valuetext={value === undefined ? automaticLabel : valueText(value)}
				data-qa-id={qaId}
				input={{
					type: "number",
					inputMode: integer ? "numeric" : "decimal",
					min,
					max,
					step,
					value: inputValue,
					placeholder: automaticLabel,
					title: value === undefined ? `Automatic: ${automaticLabel}` : undefined,
					"aria-label":
						value === undefined
							? `${inputAriaLabel}, automatic: ${automaticLabel}`
							: inputAriaLabel,
					onChange: (event) => setInputValue(event.target.value),
					onBlur: commitInput,
					onKeyDown: (event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					},
				}}
				onValueChange={(nextValue) => {
					applySliderValue(scalarSliderValue(nextValue));
				}}
				onValueCommitted={(nextValue) => {
					onCommit(applySliderValue(scalarSliderValue(nextValue)));
				}}
			/>
		</Field>
	);
}

export function ModelSettingsPanel({
	model,
	error,
	onSave,
}: {
	model: LocalModel;
	error?: string | undefined;
	onSave: (settings: LocalModelSettings) => void;
}) {
	const savedSettings = useRef<LocalModelSettings>(model.settings ?? {});
	const [includeKiloContext, setIncludeKiloContext] = useState(
		model.settings?.includeKiloContext === true,
	);
	const [extraArguments, setExtraArguments] = useState(
		serializeLlamaFlags(model.settings?.llamaFlags ?? {}),
	);
	const [extraArgumentsError, setExtraArgumentsError] = useState<string>();

	const save = (change: Partial<LocalModelSettings>) => {
		const next = { ...savedSettings.current, ...change };
		savedSettings.current = next;
		onSave(next);
	};
	const saveNumericSetting = (key: LlamaOverridableModelSetting, value: number | undefined) => {
		const next = { ...savedSettings.current };
		if (value === undefined) delete next[key];
		else next[key] = value;
		savedSettings.current = next;
		onSave(next);
	};
	const commitExtraArguments = () => {
		const parsed = parseLlamaFlags(extraArguments);
		if (!parsed.ok) {
			setExtraArgumentsError(parsed.error);
			return;
		}

		const next = { ...savedSettings.current };
		if (Object.keys(parsed.flags).length > 0) next.llamaFlags = parsed.flags;
		else delete next.llamaFlags;
		savedSettings.current = next;
		setExtraArgumentsError(undefined);
		onSave(next);
	};

	return (
		<div className="min-w-0">
			<Accordion
				multiple
				defaultValue={["general"]}
				className="border-border min-w-0 overflow-hidden rounded-lg border"
			>
				<AccordionItem value="general" className="min-w-0">
					<AccordionTrigger className="hover:bg-foreground/5 rounded-none px-3 py-2.5 text-sm no-underline transition-colors hover:no-underline">
						General
					</AccordionTrigger>
					<AccordionContent className="border-border border-t px-3 py-3">
						<FieldGroup className="gap-5">
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel className="text-sm" htmlFor={`local-model-kilo-context-${model.id}`}>
										Coding tools and instructions
									</FieldLabel>
									<FieldDescription className="text-xs">
										Off by default for faster local inference. Turn on to give this model the coding
										instructions and tools available in chat.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`local-model-kilo-context-${model.id}`}
									checked={includeKiloContext}
									aria-label="Coding tools and instructions"
									data-qa-id="local-model-settings-kilo-context"
									onCheckedChange={(checked) => {
										setIncludeKiloContext(checked);
										save({ includeKiloContext: checked });
									}}
								/>
							</Field>
							<NumericSettingSlider
								id={`local-model-context-length-${model.id}`}
								label="Context length"
								description="Larger contexts use more memory and may reduce generation speed."
								initialValue={model.settings?.contextLength}
								fallbackValue={DEFAULT_CONTEXT_LENGTH}
								automaticLabel="Model default"
								min={MIN_CONTEXT_LENGTH}
								max={MAX_CONTEXT_LENGTH}
								step={256}
								integer
								sliderMin={MIN_CONTEXT_EXPONENT}
								sliderMax={MAX_CONTEXT_EXPONENT}
								sliderStep={1}
								settingFromSlider={contextLengthFromExponent}
								sliderFromSetting={contextExponent}
								valueText={formatTokenCount}
								inputAriaLabel="Context length in tokens"
								qaId="local-model-settings-context-length"
								onCommit={(value) => saveNumericSetting("contextLength", value)}
							/>
							<NumericSettingSlider
								id={`local-model-temperature-${model.id}`}
								label="Temperature"
								description="Lower values are more predictable; higher values produce more varied responses."
								initialValue={model.settings?.temperature}
								fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.temperature}
								automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.temperature)}
								min={0}
								max={2}
								step={0.1}
								inputAriaLabel="Temperature value"
								qaId="local-model-settings-temperature"
								onCommit={(value) => saveNumericSetting("temperature", value)}
							/>
							<NumericSettingSlider
								id={`local-model-max-tokens-${model.id}`}
								label="Max tokens"
								description="Limits the number of tokens generated in each response."
								initialValue={model.settings?.maxResponseTokens}
								fallbackValue={DEFAULT_MAX_RESPONSE_TOKENS}
								automaticLabel="Unlimited"
								min={1}
								max={MAX_CONTEXT_LENGTH}
								step={1}
								integer
								sliderMin={0}
								sliderMax={MAX_CONTEXT_EXPONENT}
								sliderStep={1}
								settingFromSlider={contextLengthFromExponent}
								sliderFromSetting={contextExponent}
								valueText={formatTokenCount}
								inputAriaLabel="Max tokens value"
								qaId="local-model-settings-max-tokens"
								onCommit={(value) => saveNumericSetting("maxResponseTokens", value)}
							/>
						</FieldGroup>
					</AccordionContent>
				</AccordionItem>

				<AccordionItem value="sampling" className="min-w-0">
					<AccordionTrigger className="hover:bg-foreground/5 rounded-none px-3 py-2.5 text-sm no-underline transition-colors hover:no-underline">
						Sampling
					</AccordionTrigger>
					<AccordionContent className="border-border border-t px-3 py-3">
						<FieldGroup className="gap-5">
							<NumericSettingSlider
								id={`local-model-top-p-${model.id}`}
								label="Top P"
								description="Limits sampling to tokens within this cumulative probability."
								initialValue={model.settings?.topP}
								fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.topP}
								automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.topP)}
								min={0}
								max={1}
								step={0.01}
								inputAriaLabel="Top P value"
								qaId="local-model-settings-top-p"
								onCommit={(value) => saveNumericSetting("topP", value)}
							/>
							<NumericSettingSlider
								id={`local-model-top-k-${model.id}`}
								label="Top K"
								description="Limits sampling to the most likely tokens; 0 disables the limit."
								initialValue={model.settings?.topK}
								fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.topK}
								automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.topK)}
								min={0}
								max={100}
								step={1}
								integer
								inputAriaLabel="Top K value"
								qaId="local-model-settings-top-k"
								onCommit={(value) => saveNumericSetting("topK", value)}
							/>
							<NumericSettingSlider
								id={`local-model-min-p-${model.id}`}
								label="Min P"
								description="Filters tokens below this probability relative to the most likely token."
								initialValue={model.settings?.minP}
								fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.minP}
								automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.minP)}
								min={0}
								max={1}
								step={0.01}
								inputAriaLabel="Min P value"
								qaId="local-model-settings-min-p"
								onCommit={(value) => saveNumericSetting("minP", value)}
							/>
							<NumericSettingSlider
								id={`local-model-repeat-penalty-${model.id}`}
								label="Repetition penalty"
								description="Higher values discourage repeated token sequences; 1.0 disables the penalty."
								initialValue={model.settings?.repeatPenalty}
								fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.repeatPenalty}
								automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.repeatPenalty)}
								min={0}
								max={2}
								step={0.1}
								inputAriaLabel="Repetition penalty value"
								qaId="local-model-settings-repeat-penalty"
								onCommit={(value) => saveNumericSetting("repeatPenalty", value)}
							/>
							<NumericSettingSlider
								id={`local-model-presence-penalty-${model.id}`}
								label="Presence penalty"
								description="Higher values favor tokens that have not appeared yet; 0 disables the penalty."
								initialValue={model.settings?.presencePenalty}
								fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.presencePenalty}
								automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.presencePenalty)}
								min={0}
								max={2}
								step={0.1}
								inputAriaLabel="Presence penalty value"
								qaId="local-model-settings-presence-penalty"
								onCommit={(value) => saveNumericSetting("presencePenalty", value)}
							/>
						</FieldGroup>
					</AccordionContent>
				</AccordionItem>

				<AccordionItem value="advanced" className="min-w-0">
					<AccordionTrigger className="hover:bg-foreground/5 rounded-none px-3 py-2.5 text-sm no-underline transition-colors hover:no-underline">
						Advanced
					</AccordionTrigger>
					<AccordionContent className="border-border border-t px-3 py-3">
						<FieldGroup>
							<Field className="gap-3" data-invalid={Boolean(extraArgumentsError)}>
								<FieldLabel className="text-sm" htmlFor={`local-model-extra-arguments-${model.id}`}>
									Extra Arguments
								</FieldLabel>
								<Textarea
									id={`local-model-extra-arguments-${model.id}`}
									value={extraArguments}
									aria-invalid={Boolean(extraArgumentsError) || undefined}
									placeholder={"--n-gpu-layers 99\n--flash-attn on"}
									className="min-h-24 resize-y font-mono text-xs"
									data-qa-id="local-model-settings-extra-arguments"
									onChange={(event) => {
										setExtraArguments(event.target.value);
										setExtraArgumentsError(undefined);
									}}
									onBlur={commitExtraArguments}
								/>
								<FieldDescription className="text-xs">
									Paste llama.cpp flags exactly as you would on the command line. Matching values
									override the model settings above; app-managed flags are refused.
								</FieldDescription>
								{extraArgumentsError ? <FieldError>{extraArgumentsError}</FieldError> : null}
							</Field>
						</FieldGroup>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
			{error ? (
				<Field data-invalid>
					<FieldError>{error}</FieldError>
				</Field>
			) : null}
		</div>
	);
}

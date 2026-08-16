import {
  REQUEST_NOTES_MAX_LENGTH,
  REQUEST_OBJECTIVE_MAX_LENGTH,
  supportedMapChoices,
  type RequestFormValidation,
  validateRequestForm,
} from "../../domain/help-request";

export const DISCORD_REQUEST_COMMAND = "request";
export const DISCORD_REQUEST_MODAL_ID = "request:create:v1";

const fields = {
  twitchLogin: "request:twitch-name",
  inGameName: "request:in-game-name",
  map: "request:map",
  objective: "request:objective",
  notes: "request:notes",
} as const;

interface DiscordModalInput {
  type: 4;
  custom_id: string;
  style: 1 | 2;
  required: boolean;
  max_length: number;
  placeholder?: string;
  value?: string;
}

interface DiscordModalSelect {
  type: 3;
  custom_id: string;
  required: true;
  min_values: 1;
  max_values: 1;
  placeholder: string;
  options: ReadonlyArray<{ label: string; value: string }>;
}

interface DiscordModalLabel {
  type: 18;
  label: string;
  description?: string;
  component: DiscordModalInput | DiscordModalSelect;
}

export interface DiscordRequestModal {
  custom_id: typeof DISCORD_REQUEST_MODAL_ID;
  title: string;
  components: DiscordModalLabel[];
}

function textInput(
  customId: string,
  style: 1 | 2,
  required: boolean,
  maxLength: number,
  placeholder?: string,
  value?: string,
): DiscordModalInput {
  return {
    type: 4,
    custom_id: customId,
    style,
    required,
    max_length: maxLength,
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(value === undefined ? {} : { value }),
  };
}

export function buildDiscordRequestModal(initial?: {
  twitchLogin?: string;
  inGameName?: string;
}): DiscordRequestModal {
  return {
    custom_id: DISCORD_REQUEST_MODAL_ID,
    title: "Ask for raid help",
    components: [
      {
        type: 18,
        label: "Twitch name",
        description: "Required. You can omit the @ sign.",
        component: textInput(
          fields.twitchLogin,
          1,
          true,
          25,
          "Your Twitch name",
          initial?.twitchLogin,
        ),
      },
      {
        type: 18,
        label: "In-game name",
        component: textInput(
          fields.inGameName,
          1,
          true,
          64,
          "Your Escape from Tarkov name",
          initial?.inGameName,
        ),
      },
      {
        type: 18,
        label: "Map",
        component: {
          type: 3,
          custom_id: fields.map,
          required: true,
          min_values: 1,
          max_values: 1,
          placeholder: "Choose a map",
          options: supportedMapChoices(),
        },
      },
      {
        type: 18,
        label: "What do you need help with?",
        description: "Maximum 150 characters.",
        component: textInput(
          fields.objective,
          2,
          true,
          REQUEST_OBJECTIVE_MAX_LENGTH,
          "Task, objective, or item",
        ),
      },
      {
        type: 18,
        label: "Notes",
        description: "Optional. Maximum 250 characters.",
        component: textInput(fields.notes, 2, false, REQUEST_NOTES_MAX_LENGTH),
      },
    ],
  };
}

export function validateDiscordRequestModal(
  values: Readonly<Record<string, string>>,
): RequestFormValidation {
  return validateRequestForm({
    twitchLogin: values[fields.twitchLogin] ?? "",
    inGameName: values[fields.inGameName] ?? "",
    map: values[fields.map] ?? "",
    objective: values[fields.objective] ?? "",
    ...(values[fields.notes] === undefined ? {} : { notes: values[fields.notes] }),
  });
}

export function buildDiscordRequestValidationReply(validation: RequestFormValidation): string {
  if (validation.valid) {
    throw new Error("A valid request has no validation reply");
  }
  return `Please fix this request:\n${validation.issues.map((issue) => `• ${issue.message}`).join("\n")}`;
}

export function buildDiscordRequestCreatedReply(
  mapName: string,
  outcome: "created" | "duplicate_delivery" | "already_active",
): string {
  return outcome === "already_active"
    ? `You are already queued for ${mapName}. Use \`/queue\` to check it.`
    : `Your help request for ${mapName} is in the queue. Use \`/queue\` to check it.`;
}

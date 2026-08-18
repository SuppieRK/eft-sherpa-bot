import { resolveTarkovMap, TARKOV_MAPS } from "./maps/catalog";
import type { RequestState } from "./sherpa-repository";
import { normalizeTwitchLogin } from "./user-identity";
import type { GameMode } from "./game-mode";

type RequestFormField = "twitchLogin" | "inGameName" | "map" | "objective" | "notes";

export const REQUEST_OBJECTIVE_MAX_LENGTH = 150;
export const REQUEST_NOTES_MAX_LENGTH = 250;

export interface RequestFormInput {
  gameMode: GameMode;
  inGameName: string;
  map: string;
  objective: string;
  notes?: string;
  twitchLogin: string;
}

interface ValidatedRequestForm {
  gameMode: GameMode;
  inGameName: string;
  mapId: string;
  objective: string;
  notes?: string;
  twitchLogin: string;
}

interface RequestFormIssue {
  field: RequestFormField;
  message: string;
}

export type RequestFormValidation =
  | { valid: true; value: ValidatedRequestForm }
  | { valid: false; issues: RequestFormIssue[] };

const requestTransitions: Readonly<Record<RequestState, readonly RequestState[]>> = {
  waiting: ["planned", "canceled"],
  planned: ["waiting", "completed", "canceled"],
  completed: [],
  canceled: [],
};

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function validateRequestForm(input: RequestFormInput): RequestFormValidation {
  const twitchLogin = normalizeTwitchLogin(input.twitchLogin);
  const inGameName = input.inGameName.trim();
  const objective = input.objective.trim();
  const notes = optionalTrimmed(input.notes);
  const map = resolveTarkovMap(input.map);
  const issues: RequestFormIssue[] = [];

  if (twitchLogin === undefined) {
    issues.push({
      field: "twitchLogin",
      message: "Enter your Twitch name using letters, numbers, or underscore.",
    });
  }

  if (inGameName.length === 0) {
    issues.push({ field: "inGameName", message: "Enter your in-game name." });
  }
  if (map === undefined) {
    issues.push({ field: "map", message: "Choose one of the supported maps." });
  }
  if (objective.length === 0) {
    issues.push({ field: "objective", message: "Enter the objective or task." });
  } else if (objective.length > REQUEST_OBJECTIVE_MAX_LENGTH) {
    issues.push({ field: "objective", message: "Keep the objective to 150 characters or fewer." });
  }
  if (notes !== undefined && notes.length > REQUEST_NOTES_MAX_LENGTH) {
    issues.push({ field: "notes", message: "Keep notes to 250 characters or fewer." });
  }
  if (issues.length > 0 || map === undefined || twitchLogin === undefined) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    value: {
      gameMode: input.gameMode,
      inGameName,
      twitchLogin,
      mapId: map.id,
      objective,
      ...(notes === undefined ? {} : { notes }),
    },
  };
}

export function supportedMapChoices(): ReadonlyArray<{ label: string; value: string }> {
  return TARKOV_MAPS.map((map) => ({ label: map.name, value: map.id }));
}

export function canTransitionRequest(from: RequestState, to: RequestState): boolean {
  return requestTransitions[from].includes(to);
}

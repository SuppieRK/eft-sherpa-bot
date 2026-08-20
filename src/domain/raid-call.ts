import type { TarkovMapDefinition } from "./maps/catalog";

export function appendRaidBringSuffix(
  message: string,
  map: TarkovMapDefinition | undefined,
): string {
  const reminder = map?.raidPreparationReminder;
  if (reminder === undefined) return message;

  const trimmedMessage = message.trimEnd();
  const separator = /[.!?]$/.test(trimmedMessage) ? " " : ". ";
  return `${trimmedMessage}${separator}Bring: ${reminder}`;
}

import { normalizeTwitchLogin } from "../../domain/user-identity";

export const DISCORD_LINK_TWITCH_COMMAND = "link-twitch";

export function parseTwitchNameOption(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeTwitchLogin(value);
}

export function parseEftNameOption(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 || trimmed.length > 64 ? undefined : trimmed;
}

export function buildTwitchLinkedReply(
  twitchLogin: string,
  discordUserId: string,
  inGameName?: string,
): string {
  const eft = inGameName === undefined ? "" : ` EFT name: ${inGameName}.`;
  return `Linked Twitch @${twitchLogin} to <@${discordUserId}>.${eft}`;
}

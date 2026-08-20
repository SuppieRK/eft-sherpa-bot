import type { StaffStatistics } from "../../domain/staff-statistics";
import type {
  StaffUserDirectoryEntry,
  StaffUserDirectoryPage,
} from "../../domain/staff-user-directory";

export const DISCORD_STAFF_STATS_COMMAND = "stats";
export const DISCORD_STAFF_USERS_COMMAND = "users";
export const USER_DIRECTORY_EFT_FIELD = "users:eft-name";
const USERS_PREFIX = "users:v1";

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  fields: DiscordEmbedField[];
}

interface DiscordButton {
  type: 2;
  style: 1 | 2;
  custom_id: string;
  label: string;
  disabled?: boolean;
}

interface DiscordStringSelect {
  type: 3;
  custom_id: string;
  placeholder: string;
  min_values: 1;
  max_values: 1;
  options: Array<{ label: string; value: string; description?: string }>;
  disabled?: boolean;
}

interface DiscordUserSelect {
  type: 5;
  custom_id: string;
  placeholder: string;
  min_values: 1;
  max_values: 1;
}

type DiscordComponent = DiscordButton | DiscordStringSelect | DiscordUserSelect;

export interface StaffInsightsMessage {
  embeds: DiscordEmbed[];
  components: Array<{ type: 1; components: DiscordComponent[] }>;
  allowed_mentions: { parse: [] };
}

export type UserDirectoryAction =
  | { action: "next" | "previous" | "at"; cursor: string }
  | { action: "detail"; pageFirst: string }
  | { action: "add_discord" | "add_eft"; twitchLogin: string; pageFirst: string };

function validLogin(value: string): boolean {
  return /^[a-z0-9_]{1,25}$/.test(value);
}

function encode(action: string, ...values: string[]): string {
  return [USERS_PREFIX, action, ...values].join(":");
}

export function parseUserDirectoryAction(customId: string): UserDirectoryAction | undefined {
  const parts = customId.split(":");
  if (parts[0] !== "users" || parts[1] !== "v1") return undefined;
  if (["next", "previous", "at"].includes(parts[2] ?? "") && parts.length === 4) {
    const cursor = parts[3] as string;
    return validLogin(cursor)
      ? { action: parts[2] as "next" | "previous" | "at", cursor }
      : undefined;
  }
  if (parts[2] === "detail" && parts.length === 4 && validLogin(parts[3] ?? "")) {
    return { action: "detail", pageFirst: parts[3] as string };
  }
  if (
    ["add_discord", "add_eft"].includes(parts[2] ?? "") &&
    parts.length === 5 &&
    validLogin(parts[3] ?? "") &&
    validLogin(parts[4] ?? "")
  ) {
    return {
      action: parts[2] as "add_discord" | "add_eft",
      twitchLogin: parts[3] as string,
      pageFirst: parts[4] as string,
    };
  }
  return undefined;
}

export function renderStaffStatistics(statistics: StaffStatistics): StaffInsightsMessage {
  const totals = [
    `- Submitted: ${statistics.submittedRequests}`,
    `- Helped: ${statistics.helpedRequests}`,
    `- Open: ${statistics.openRequests}`,
    `- Canceled: ${statistics.canceledRequests}`,
    `- Successful raids: ${statistics.successfulRaids}`,
  ].join("\n");
  const leaders = statistics.leaders.map(
    (leader, index) =>
      `${index + 1}. <@${leader.discordUserId}> — ${leader.helpedRequests} requests (${leader.successfulRaids} raids)`,
  );
  if (statistics.omittedLeaderCount > 0) {
    leaders.push(`- ${statistics.omittedLeaderCount} more leaders`);
  }
  return {
    embeds: [
      {
        title: "All-time sherpa statistics",
        fields: [
          { name: "Requests and raids", value: totals },
          { name: "Leaders", value: leaders.join("\n") || "No helped raids yet." },
        ],
      },
    ],
    components: [],
    allowed_mentions: { parse: [] },
  };
}

function directoryEntry(entry: StaffUserDirectoryEntry): string {
  return [
    `Twitch: @${entry.twitchLogin} (${entry.twitchIdentityObserved ? "ID observed" : "ID not observed"})`,
    `Discord: ${entry.discordUserId === undefined ? "Not linked (optional)" : `<@${entry.discordUserId}>`}`,
    `EFT: ${entry.inGameName === undefined ? "Missing" : entry.inGameName.replaceAll(/([\\`*_~|>])/g, "\\$1")}`,
  ].join("\n");
}

export function renderUserDirectory(page: StaffUserDirectoryPage): StaffInsightsMessage {
  const first = page.entries[0]?.twitchLogin;
  const last = page.entries.at(-1)?.twitchLogin;
  const incomplete = page.entries.filter(
    (entry) => entry.discordUserId === undefined || entry.inGameName === undefined,
  );
  const fields = page.entries.map((entry) => ({
    name: `@${entry.twitchLogin}`,
    value: directoryEntry(entry),
  }));
  if (fields.length === 0) fields.push({ name: "No users", value: "No user records exist yet." });
  const navigation: DiscordButton[] = [
    {
      type: 2,
      style: 2,
      custom_id: encode("previous", first ?? "none"),
      label: "Previous",
      disabled: !page.hasPrevious || first === undefined,
    },
    {
      type: 2,
      style: 2,
      custom_id: encode("next", last ?? "none"),
      label: "Next",
      disabled: !page.hasNext || last === undefined,
    },
  ];
  const components: StaffInsightsMessage["components"] = [{ type: 1, components: navigation }];
  if (first !== undefined) {
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: encode("detail", first),
          placeholder: "Complete user details",
          min_values: 1,
          max_values: 1,
          options:
            incomplete.length === 0
              ? [{ label: "All visible users are complete", value: "none" }]
              : incomplete.map((entry) => ({
                  label: `@${entry.twitchLogin}`,
                  value: entry.twitchLogin,
                  description: [
                    entry.discordUserId === undefined ? "Discord missing" : undefined,
                    entry.inGameName === undefined ? "EFT name missing" : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                })),
          disabled: incomplete.length === 0,
        },
      ],
    });
  }
  return {
    embeds: [
      {
        title: "Sherpa users",
        description:
          "Twitch IDs appear after the viewer uses the bot on Twitch. Use `/link-twitch` to correct an association.",
        fields,
      },
    ],
    components,
    allowed_mentions: { parse: [] },
  };
}

export function renderUserDetail(
  entry: StaffUserDirectoryEntry,
  pageFirst: string,
): StaffInsightsMessage {
  const components: StaffInsightsMessage["components"] = [];
  if (entry.discordUserId === undefined) {
    components.push({
      type: 1,
      components: [
        {
          type: 5,
          custom_id: encode("add_discord", entry.twitchLogin, pageFirst),
          placeholder: "Add Discord member",
          min_values: 1,
          max_values: 1,
        },
      ],
    });
  }
  const buttons: DiscordButton[] = [];
  if (entry.inGameName === undefined) {
    buttons.push({
      type: 2,
      style: 1,
      custom_id: encode("add_eft", entry.twitchLogin, pageFirst),
      label: "Add EFT name",
    });
  }
  buttons.push({
    type: 2,
    style: 2,
    custom_id: encode("at", pageFirst),
    label: "Back to users",
  });
  components.push({ type: 1, components: buttons });
  return {
    embeds: [
      {
        title: `User @${entry.twitchLogin}`,
        description:
          "Add only missing details here. Use `/link-twitch` to correct an existing association.",
        fields: [{ name: "Identity", value: directoryEntry(entry) }],
      },
    ],
    components,
    allowed_mentions: { parse: [] },
  };
}

export function buildEftNameModal(twitchLogin: string, pageFirst: string) {
  return {
    custom_id: encode("add_eft", twitchLogin, pageFirst),
    title: "Add EFT name",
    components: [
      {
        type: 18,
        label: "Escape from Tarkov name (1–64 characters)",
        component: {
          type: 4,
          custom_id: USER_DIRECTORY_EFT_FIELD,
          style: 1,
          min_length: 1,
          max_length: 64,
          required: true,
        },
      },
    ],
  };
}

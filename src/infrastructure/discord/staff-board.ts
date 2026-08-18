import { resolveTarkovMap } from "../../domain/maps/catalog";
import { formatModeMap } from "../../domain/game-mode";
import type { StaffBoardRaid, StaffBoardSnapshot } from "../../domain/staff-board";
import { discordMessageUrl } from "./messages";

export const DISCORD_STAFF_BOARD_COMMAND = "board";
const BOARD_PREFIX = "board:v5";
const RAID_PREFIX = "raid:v1";

interface Button {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  custom_id?: string;
  label: string;
  url?: string;
}

interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

interface Select {
  type: 3;
  custom_id: string;
  placeholder: string;
  min_values: 1;
  max_values: 1;
  options: SelectOption[];
}

interface ActionRow {
  type: 1;
  components: Array<Button | Select>;
}

interface EmbedField {
  name: string;
  value: string;
  inline: false;
}

interface Embed {
  title: string;
  description: string;
  fields: EmbedField[];
}

export interface DiscordBotMessage {
  content?: string;
  embeds?: Embed[];
  allowed_mentions: { parse: []; users?: string[] };
  components: ActionRow[];
}

export type StaffBoardAction = { action: "refresh" | "start" };
export type RaidMessageAction = { action: "result" | "postpone" | "remove"; raidId: number };

export function parseStaffBoardAction(value: string): StaffBoardAction | undefined {
  const match = /^board:v5:(refresh|start)$/.exec(value);
  return match === null ? undefined : { action: match[1] as StaffBoardAction["action"] };
}

export function parseRaidMessageAction(value: string): RaidMessageAction | undefined {
  const match = /^raid:v1:(result|postpone|remove):(\d+)$/.exec(value);
  if (match === null) return undefined;
  const raidId = Number(match[2]);
  return Number.isSafeInteger(raidId) && raidId > 0
    ? { action: match[1] as RaidMessageAction["action"], raidId }
    : undefined;
}

function mapName(mapId: string): string {
  return resolveTarkovMap(mapId)?.name ?? mapId;
}

function raidName(raid: StaffBoardRaid): string {
  return formatModeMap(raid.gameMode, mapName(raid.mapId));
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/([\\`*_~|>])/g, "\\$1");
}

function occupancy(raid: StaffBoardRaid): string {
  const partyCapacity =
    resolveTarkovMap(raid.mapId)?.sherpaPartyCapacity ?? raid.requesterCapacity + 1;
  return `${raid.members.length + 1}/${partyCapacity}`;
}

function participantTags(raid: StaffBoardRaid): string {
  return raid.members
    .map((member) => `@${member.twitchLogin}`)
    .join(" · ")
    .slice(0, 100);
}

function boardRaidField(
  raid: StaffBoardRaid,
  displayIndex: number,
  attemptLimit: number,
  guildId: string,
  staffChannelId: string,
): EmbedField {
  const leader =
    raid.leaderDiscordUserId === undefined
      ? "Leader: claim when starting"
      : raid.state === "planned"
        ? `Reserved leader: <@${raid.leaderDiscordUserId}>`
        : `Leader: <@${raid.leaderDiscordUserId}>`;
  const details =
    raid.state !== "active" || raid.staffMessageId === undefined
      ? ""
      : ` · [Raid details](${discordMessageUrl(guildId, staffChannelId, raid.staffMessageId)})`;
  return {
    name: `${displayIndex + 1}. ${raidName(raid)} (${occupancy(raid)})`,
    value: `${raid.state === "active" ? "Active" : "Planned"} · Attempt ${raid.attemptCount}/${attemptLimit} · ${leader}${details}`,
    inline: false,
  };
}

export function renderStaffBoard(
  snapshot: StaffBoardSnapshot,
  input: { attemptLimit: number; guildId: string; staffChannelId: string },
): DiscordBotMessage {
  const queueEmbed = (
    title: string,
    raids: readonly StaffBoardRaid[],
    raidCount: number,
    limit: number,
  ): Embed => ({
    title: `${title} raids`,
    description: `Showing ${raids.length} of ${raidCount} raids (up to ${limit}).`,
    fields:
      raids.length === 0
        ? [
            {
              name: `No ${title.toLowerCase()} raids`,
              value: "This queue is empty.",
              inline: false,
            },
          ]
        : raids.map((raid, index) =>
            boardRaidField(raid, index, input.attemptLimit, input.guildId, input.staffChannelId),
          ),
  });
  const components: ActionRow[] = [
    {
      type: 1,
      components: [{ type: 2, style: 2, custom_id: `${BOARD_PREFIX}:refresh`, label: "Refresh" }],
    },
  ];
  const visibleRaids = [
    ...snapshot.priorityRaids.map((raid, index) => ({ raid, queueOrdinal: index + 1 })),
    ...snapshot.ordinaryRaids.map((raid, index) => ({ raid, queueOrdinal: index + 1 })),
  ];
  const planned = visibleRaids.filter(({ raid }) => raid.state === "planned");
  if (planned.length > 0) {
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${BOARD_PREFIX}:start`,
          placeholder: "Start a raid",
          min_values: 1,
          max_values: 1,
          options: planned.map(({ raid, queueOrdinal }) => ({
            label:
              `${raid.queueKind === "priority" ? "Priority" : "Ordinary"} ${queueOrdinal} · ${raidName(raid)}`.slice(
                0,
                100,
              ),
            value: String(raid.id),
            description: participantTags(raid) || `${raid.members.length} requesters`,
          })),
        },
      ],
    });
  }
  return {
    content: "**Sherpa board**\nRefresh updates both queues.",
    embeds: [
      queueEmbed("Priority", snapshot.priorityRaids, snapshot.priorityRaidCount, 3),
      queueEmbed("Ordinary", snapshot.ordinaryRaids, snapshot.ordinaryRaidCount, 7),
    ],
    allowed_mentions: { parse: [] },
    components,
  };
}

export function renderRaidMessage(
  raid: StaffBoardRaid,
  attemptLimit: number,
  pingLeader = false,
): DiscordBotMessage {
  const terminal = raid.state === "completed" || raid.state === "canceled";
  const status = terminal
    ? `Result: ${raid.outcome === "helped" ? "Helped" : "Not run"}`
    : `Status: Attempt ${raid.attemptCount}/${attemptLimit} active`;
  const fields: EmbedField[] = raid.members.map((member) => {
    const identity = [
      `Twitch: @${escapeMarkdown(member.twitchLogin)}`,
      ...(member.discordUserId === undefined ? [] : [`Discord: <@${member.discordUserId}>`]),
      `EFT: ${escapeMarkdown(member.inGameName)}`,
      `Goal: ${escapeMarkdown(member.objective)}`,
      ...(member.notes === undefined ? [] : [`Notes: ${escapeMarkdown(member.notes)}`]),
    ];
    return { name: `Requester ${member.position}`, value: identity.join("\n"), inline: false };
  });
  if (fields.length === 0) {
    fields.push({ name: "No current requesters", value: "This raid will not run.", inline: false });
  }
  const components: ActionRow[] = [];
  if (!terminal) {
    const finalAttempt = raid.attemptCount >= attemptLimit;
    const outcomes: SelectOption[] = [
      {
        label: `${raidName(raid)} · Helped`,
        value: "helped",
        description: participantTags(raid),
      },
      ...(finalAttempt
        ? []
        : [
            {
              label: `${raidName(raid)} · Record unsuccessful attempt`,
              value: "unsuccessful",
              description: participantTags(raid),
            },
          ]),
      {
        label: `${raidName(raid)} · Postpone raid`,
        value: "postpone_raid",
        description: participantTags(raid),
      },
    ];
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${RAID_PREFIX}:result:${raid.id}`,
          placeholder: "Record a raid result",
          min_values: 1,
          max_values: 1,
          options: outcomes,
        },
      ],
    });
    if (raid.members.length > 0) {
      components.push({
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${RAID_PREFIX}:postpone:${raid.id}`,
            placeholder: "Postpone requester",
            min_values: 1,
            max_values: 1,
            options: raid.members.map((member) => ({
              label: `@${member.twitchLogin}`.slice(0, 100),
              value: String(member.requestId),
              description: member.objective.slice(0, 100),
            })),
          },
        ],
      });
      components.push({
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${RAID_PREFIX}:remove:${raid.id}`,
            placeholder: "Remove requester",
            min_values: 1,
            max_values: 1,
            options: raid.members.map((member) => ({
              label: `@${member.twitchLogin}`.slice(0, 100),
              value: String(member.requestId),
              description: member.objective.slice(0, 100),
            })),
          },
        ],
      });
    }
  }
  return {
    content:
      raid.leaderDiscordUserId === undefined
        ? ""
        : `<@${raid.leaderDiscordUserId}> this raid is ready.`,
    embeds: [
      {
        title: `${raidName(raid)} raid`,
        description: `${status}\nParty: ${occupancy(raid)}\nLeader: ${raid.leaderDiscordUserId === undefined ? "Not assigned" : `<@${raid.leaderDiscordUserId}>`}\nCalls: Discord ${raid.discordCallStatus} · Twitch ${raid.twitchCallStatus}`,
        fields,
      },
    ],
    allowed_mentions: {
      parse: [],
      ...(pingLeader && raid.leaderDiscordUserId !== undefined
        ? { users: [raid.leaderDiscordUserId] }
        : {}),
    },
    components,
  };
}

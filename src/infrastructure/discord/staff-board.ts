import { resolveTarkovMap } from "../../domain/maps/catalog";
import { formatModeMap } from "../../domain/game-mode";
import type { StaffBoardRaid, StaffBoardSnapshot } from "../../domain/staff-board";
import { discordMessageUrl } from "./messages";

export const DISCORD_STAFF_BOARD_COMMAND = "board";
const BOARD_PREFIX = "board:v6";
const RAID_PREFIX = "raid:v3";

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
  disabled?: boolean;
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

export type StaffBoardAction = { action: "refresh" | "review" | "retired_start" };
type SingleRaidMessageAction =
  | "call"
  | "result"
  | "postpone"
  | "remove"
  | "pull_candidates"
  | "cancel";
export type RaidMessageAction =
  | {
      action: SingleRaidMessageAction;
      raidId: number;
    }
  | { action: "pull"; raidId: number; sourceRaidId: number };

export function parseStaffBoardAction(value: string): StaffBoardAction | undefined {
  const current = /^board:v6:(refresh|review)$/.exec(value);
  if (current !== null) return { action: current[1] as "refresh" | "review" };
  if (value === "board:v5:refresh") return { action: "refresh" };
  if (value === "board:v5:start") return { action: "retired_start" };
  return undefined;
}

export function parseRaidMessageAction(value: string): RaidMessageAction | undefined {
  const pull = /^raid:v3:pull:(\d+):(\d+)$/.exec(value);
  if (pull !== null) {
    const raidId = Number(pull[1]);
    const sourceRaidId = Number(pull[2]);
    return Number.isSafeInteger(raidId) &&
      raidId > 0 &&
      Number.isSafeInteger(sourceRaidId) &&
      sourceRaidId > 0
      ? { action: "pull", raidId, sourceRaidId }
      : undefined;
  }
  const match = /^raid:v3:(call|result|postpone|remove|pull_candidates|cancel):(\d+)$/.exec(value);
  const previous = /^raid:v2:(call|result|postpone|remove):(\d+)$/.exec(value);
  const legacy = /^raid:v1:(result|postpone|remove):(\d+)$/.exec(value);
  const selected = match ?? previous ?? legacy;
  if (selected === null) return undefined;
  const raidId = Number(selected[2]);
  return Number.isSafeInteger(raidId) && raidId > 0
    ? { action: selected[1] as SingleRaidMessageAction, raidId }
    : undefined;
}

function mapName(mapId: string): string {
  return resolveTarkovMap(mapId)?.name ?? mapId;
}

function raidName(raid: StaffBoardRaid): string {
  return formatModeMap(raid.gameMode, mapName(raid.mapId));
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/([\\`*_~|>])/g, String.raw`\$1`);
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

function boardRequesterTags(raid: StaffBoardRaid): string {
  return raid.members.map((member) => `@${escapeMarkdown(member.twitchLogin)}`).join(" · ");
}

function boardRaidField(
  raid: StaffBoardRaid,
  displayIndex: number,
  attemptLimit: number,
  guildId: string,
  staffChannelId: string,
): EmbedField {
  let leader = "Leader: assigned when called";
  if (raid.leaderDiscordUserId !== undefined) {
    const label = raid.state === "planned" ? "Reserved leader" : "Leader";
    leader = `${label}: <@${raid.leaderDiscordUserId}>`;
  }
  const details =
    raid.staffMessageId === undefined
      ? ""
      : ` · [Raid details](${discordMessageUrl(guildId, staffChannelId, raid.staffMessageId)})`;
  return {
    name: `${displayIndex + 1}. ${raidName(raid)}`,
    value: `Requesters: ${boardRequesterTags(raid)}\n${raid.state === "active" ? "Active" : "Planned"} · Attempt ${raid.attemptCount}/${attemptLimit} · ${leader}${details}`,
    inline: false,
  };
}

function raidStatus(raid: StaffBoardRaid, attemptLimit: number): string {
  if (raid.state === "completed" || raid.state === "canceled") {
    const outcome = raid.outcome === "helped" ? "Helped" : "Not run";
    return `Result: ${outcome}`;
  }
  if (raid.state === "planned") {
    return `Status: Planned review · Attempt ${raid.attemptCount}/${attemptLimit}`;
  }
  return `Status: Attempt ${raid.attemptCount}/${attemptLimit} active`;
}

function raidRequesterFields(raid: StaffBoardRaid): EmbedField[] {
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
  return fields;
}

function plannedRaidControls(raid: StaffBoardRaid, pullSource?: StaffBoardRaid): ActionRow[] {
  const callButtons: Button[] = [
    {
      type: 2,
      style: 1,
      custom_id: `${RAID_PREFIX}:call:${raid.id}`,
      label: "Call and start raid",
    },
  ];
  if (!raid.automaticFill) {
    callButtons.push({
      type: 2,
      style: 2,
      custom_id: `${RAID_PREFIX}:cancel:${raid.id}`,
      label: "Cancel review",
    });
  }
  const controls: ActionRow[] = [{ type: 1, components: callButtons }];
  if (raid.automaticFill || raid.members.length >= raid.requesterCapacity) return controls;

  const hasCandidates = pullSource !== undefined && pullSource.members.length > 0;
  const customId = hasCandidates
    ? `${RAID_PREFIX}:pull:${raid.id}:${pullSource.id}`
    : `${RAID_PREFIX}:pull_candidates:${raid.id}`;
  const options = hasCandidates
    ? pullSource.members.map((member) => ({
        label: `@${member.twitchLogin}`.slice(0, 100),
        value: String(member.requestId),
        description: member.objective.slice(0, 100),
      }))
    : [{ label: "No compatible requester available", value: "unavailable" }];
  controls.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId,
        placeholder: "Pull requester up",
        min_values: 1,
        max_values: 1,
        options,
        ...(!hasCandidates ? { disabled: true } : {}),
      },
    ],
  });
  return controls;
}

function activeRaidControls(raid: StaffBoardRaid, attemptLimit: number): ActionRow[] {
  const outcomes: SelectOption[] = [
    {
      label: `${raidName(raid)} · Helped`,
      value: "helped",
      description: participantTags(raid),
    },
  ];
  if (raid.attemptCount < attemptLimit) {
    outcomes.push({
      label: `${raidName(raid)} · Record unsuccessful attempt`,
      value: "unsuccessful",
      description: participantTags(raid),
    });
  }
  outcomes.push({
    label: `${raidName(raid)} · Postpone raid`,
    value: "postpone_raid",
    description: participantTags(raid),
  });
  return [
    {
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
    },
  ];
}

function requesterControls(raid: StaffBoardRaid): ActionRow[] {
  if (raid.state === "completed" || raid.state === "canceled" || raid.members.length === 0) {
    return [];
  }
  const options = raid.members.map((member) => ({
    label: `@${member.twitchLogin}`.slice(0, 100),
    value: String(member.requestId),
    description: member.objective.slice(0, 100),
  }));
  const postponePlaceholder =
    raid.state === "planned" ? "Move requester to next raid" : "Postpone requester";
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${RAID_PREFIX}:postpone:${raid.id}`,
          placeholder: postponePlaceholder,
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `${RAID_PREFIX}:remove:${raid.id}`,
          placeholder: "Remove requester",
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    },
  ];
}

function raidNotification(raid: StaffBoardRaid, notificationUserId?: string): string {
  if (notificationUserId !== undefined) {
    return `<@${notificationUserId}> review this proposed raid.`;
  }
  if (raid.state === "active" && raid.leaderDiscordUserId !== undefined) {
    return `<@${raid.leaderDiscordUserId}> this raid is ready.`;
  }
  return "";
}

function raidDescription(raid: StaffBoardRaid, status: string): string {
  const leader =
    raid.leaderDiscordUserId === undefined ? "Not assigned" : `<@${raid.leaderDiscordUserId}>`;
  const calls =
    raid.state === "planned"
      ? "Calls: No requesters have been called."
      : `Calls: Discord ${raid.discordCallStatus} · Twitch ${raid.twitchCallStatus}`;
  return `${status}\nParty: ${occupancy(raid)}\nLeader: ${leader}\n${calls}`;
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
          custom_id: `${BOARD_PREFIX}:review`,
          placeholder: "Review a raid",
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
  notificationUserId?: string,
  pullSource?: StaffBoardRaid,
): DiscordBotMessage {
  const terminal = raid.state === "completed" || raid.state === "canceled";
  const status = raidStatus(raid, attemptLimit);
  const fields = raidRequesterFields(raid);
  let components: ActionRow[] = [];
  if (raid.state === "planned") {
    components = plannedRaidControls(raid, pullSource);
  } else if (!terminal) {
    components = activeRaidControls(raid, attemptLimit);
  }
  components.push(...requesterControls(raid));
  return {
    content: raidNotification(raid, notificationUserId),
    embeds: [
      {
        title: `${raidName(raid)} raid`,
        description: raidDescription(raid, status),
        fields,
      },
    ],
    allowed_mentions: {
      parse: [],
      ...(notificationUserId === undefined ? {} : { users: [notificationUserId] }),
    },
    components,
  };
}

export function renderPullRequesterSelector(
  destination: StaffBoardRaid,
  source: StaffBoardRaid,
): DiscordBotMessage {
  return {
    content: `Choose one requester to pull into the ${raidName(destination)} raid.`,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${RAID_PREFIX}:pull:${destination.id}:${source.id}`,
            placeholder: "Pull requester up",
            min_values: 1,
            max_values: 1,
            options: source.members.map((member) => ({
              label: `@${member.twitchLogin}`.slice(0, 100),
              value: String(member.requestId),
              description: member.objective.slice(0, 100),
            })),
          },
        ],
      },
    ],
  };
}

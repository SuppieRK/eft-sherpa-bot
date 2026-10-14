import { formatModeMap } from "../../domain/game-mode";
import { resolveTarkovMap } from "../../domain/maps/catalog";
import {
  BOARD_PAGE_SIZE,
  type BoardPageTarget,
  type PullRequesterSource,
  type StaffBoardRaid,
  type StaffBoardSnapshot,
} from "../../domain/staff-board";

import { discordMessageUrl } from "./messages";

export const DISCORD_STAFF_BOARD_COMMAND = "board";
const BOARD_PREFIX = "board:v7";
const RAID_PREFIX = "raid:v4";

interface Button {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  custom_id?: string;
  label: string;
  url?: string;
  disabled?: boolean;
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

export type StaffBoardAction =
  | { action: "refresh" | "review" | "retired_start" }
  | { action: "move" | "unmove"; version: number }
  | { action: "page"; version: number; target: BoardPageTarget };
type SingleRaidMessageAction =
  | "call"
  | "result"
  | "postpone"
  | "remove"
  | "pull_candidates"
  | "cancel";
export type RaidMessageAction =
  | { action: "move"; raidId: number; destinationRaidId: number }
  | {
      action: SingleRaidMessageAction;
      raidId: number;
    }
  | { action: "pull" | "pull_page"; raidId: number; sourceRaidId: number };

export function parseStaffBoardAction(value: string): StaffBoardAction | undefined {
  const simple = /^board:v7:(refresh|review)$/.exec(value);
  if (simple !== null) return { action: simple[1] as "refresh" | "review" };
  if (/^board:v[56]:refresh$/.test(value)) return { action: "refresh" };
  if (/^board:v[56]:(start|review)$/.test(value)) return { action: "retired_start" };
  const placement = /^board:v7:(move|unmove):(\d+)$/.exec(value);
  if (placement !== null) {
    const version = Number(placement[2]);
    return Number.isSafeInteger(version)
      ? { action: placement[1] as "move" | "unmove", version }
      : undefined;
  }
  const page = /^board:v7:page:(\d+):(previous|next):([01]):(-?\d+):(\d+):(\d+)$/.exec(value);
  if (page === null) return undefined;
  const version = Number(page[1]),
    lane = Number(page[3]),
    key = Number(page[4]),
    id = Number(page[5]),
    pageNumber = Number(page[6]);
  if (
    ![version, lane, key, id, pageNumber].every(Number.isSafeInteger) ||
    (lane !== 0 && lane !== 1) ||
    id < 1 ||
    pageNumber < 1
  )
    return undefined;
  return {
    action: "page",
    version,
    target: {
      direction: page[2] === "next" ? "next" : "previous",
      boundary: { lane, key, id },
      pageNumber,
    },
  };
}

export function parseRaidMessageAction(value: string): RaidMessageAction | undefined {
  const move = /^raid:v4:move:(\d+):(\d+)$/.exec(value);
  if (move !== null) {
    const raidId = Number(move[1]),
      destinationRaidId = Number(move[2]);
    return Number.isSafeInteger(raidId) &&
      raidId > 0 &&
      Number.isSafeInteger(destinationRaidId) &&
      destinationRaidId > 0
      ? { action: "move", raidId, destinationRaidId }
      : undefined;
  }
  const pull = /^raid:v[34]:(pull|pull_page):(\d+):(\d+)$/.exec(value);
  if (pull !== null) {
    const raidId = Number(pull[2]);
    const sourceRaidId = Number(pull[3]);
    return Number.isSafeInteger(raidId) &&
      raidId > 0 &&
      Number.isSafeInteger(sourceRaidId) &&
      sourceRaidId > 0
      ? { action: pull[1] as "pull" | "pull_page", raidId, sourceRaidId }
      : undefined;
  }
  const match = /^raid:v[34]:(call|result|postpone|remove|pull_candidates|cancel):(\d+)$/.exec(
    value,
  );
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
    name: `${displayIndex + 1}. ${raidName(raid)}${raid.manualOrder > 0 ? " · Pinned" : ""}`,
    value: `Requesters: ${boardRequesterTags(raid)}\n${raid.state === "active" ? "Active" : "Planned"} · ${leader}${details}`,
    inline: false,
  };
}

function raidStatus(raid: StaffBoardRaid): string {
  if (raid.state === "completed" || raid.state === "canceled")
    return `Result: ${raid.outcome === "helped" ? "Helped" : "Not run"}`;
  return raid.state === "planned" ? "Status: Planned review" : "Status: Active";
}

function raidRequesterFields(raid: StaffBoardRaid): EmbedField[] {
  const fields: EmbedField[] = raid.members.flatMap((member) => {
    const identity = [
      `Twitch: @${escapeMarkdown(member.twitchLogin)}`,
      ...(member.discordUserId === undefined ? [] : [`Discord: <@${member.discordUserId}>`]),
      `EFT: ${escapeMarkdown(member.inGameName)}`,
      `Goal: ${escapeMarkdown(member.objective)}`,
      ...(member.notes === undefined ? [] : [`Notes: ${escapeMarkdown(member.notes)}`]),
    ];
    const name = `Requester ${member.position}`;
    const value = identity.join("\n");
    if (value.length <= 1024) return [{ name, value, inline: false }];
    const notes = identity.pop();
    return [
      { name, value: identity.join("\n"), inline: false },
      { name: `${name} notes`, value: notes ?? "No notes", inline: false },
    ];
  });
  if (fields.length === 0) {
    fields.push({ name: "No current requesters", value: "This raid will not run.", inline: false });
  }
  return fields;
}

function plannedRaidControls(raid: StaffBoardRaid): ActionRow[] {
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
  return controls;
}

function pullRequesterControls(
  raid: StaffBoardRaid,
  pullSource?: PullRequesterSource,
): ActionRow[] {
  if (
    (raid.state !== "planned" && raid.state !== "active") ||
    raid.automaticFill ||
    raid.members.length >= raid.requesterCapacity
  )
    return [];
  const controls: ActionRow[] = [];

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
  const navigation: Button[] = [];
  for (const [label, sourceId] of [
    ["Previous source", pullSource?.previousSourceId],
    ["Next source", pullSource?.nextSourceId],
  ] as const) {
    if (sourceId === undefined) continue;
    navigation.push({
      type: 2,
      style: 2,
      label,
      custom_id: `${RAID_PREFIX}:pull_page:${raid.id}:${sourceId}`,
    });
  }
  if (navigation.length > 0) controls.push({ type: 1, components: navigation });
  return controls;
}

function activeRaidControls(raid: StaffBoardRaid): ActionRow[] {
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
          options: [
            {
              label: `${raidName(raid)} · Helped`,
              value: "helped",
              description: participantTags(raid),
            },
            {
              label: `${raidName(raid)} · Postpone raid`,
              value: "postpone_raid",
              description: participantTags(raid),
            },
          ],
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
  const moveControl: ActionRow[] =
    raid.state === "active" || raid.nextMoveRaidId !== undefined
      ? [
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id:
                  raid.state === "planned"
                    ? `${RAID_PREFIX}:move:${raid.id}:${raid.nextMoveRaidId}`
                    : `${RAID_PREFIX}:postpone:${raid.id}`,
                placeholder: postponePlaceholder,
                min_values: 1,
                max_values: 1,
                options,
              },
            ],
          },
        ]
      : [];
  return [
    ...moveControl,
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
  input: { guildId: string; staffChannelId: string },
): DiscordBotMessage {
  const version = snapshot.boardVersion ?? 0;
  const pageNumber = snapshot.pageNumber;
  const pageButton = (label: string, target: BoardPageTarget | undefined): Button => ({
    type: 2,
    style: 2,
    label,
    disabled: target === undefined,
    custom_id:
      target === undefined
        ? `${BOARD_PREFIX}:disabled:${label}`
        : `${BOARD_PREFIX}:page:${version}:${target.direction}:${target.boundary.lane}:${target.boundary.key}:${target.boundary.id}:${target.pageNumber}`,
  });
  const components: ActionRow[] = [
    {
      type: 1,
      components: [
        pageButton("Previous", snapshot.previousPage),
        pageButton("Next", snapshot.nextPage),
        { type: 2, style: 2, custom_id: `${BOARD_PREFIX}:refresh`, label: "Refresh" },
      ],
    },
  ];
  const planned = snapshot.raids.filter((raid) => raid.state === "planned");
  const addSelector = (
    action: "review" | "move" | "unmove",
    placeholder: string,
    raids: StaffBoardRaid[],
  ) => {
    if (raids.length === 0) return;
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id:
            action === "review" ? `${BOARD_PREFIX}:review` : `${BOARD_PREFIX}:${action}:${version}`,
          placeholder,
          min_values: 1,
          max_values: 1,
          options: raids.map((raid) => ({
            label: `${raidName(raid)} · #${raid.id}`.slice(0, 100),
            value: String(raid.id),
            description: participantTags(raid),
          })),
        },
      ],
    });
  };
  addSelector("review", "Review a raid", planned);
  addSelector(
    "move",
    "Pin to top · Streamer only",
    planned.filter((raid) => raid.manualOrder === 0),
  );
  addSelector(
    "unmove",
    "Unpin · Streamer only",
    planned.filter((raid) => raid.manualOrder > 0),
  );
  const message: DiscordBotMessage = {
    content:
      "**Sherpa board**\nStreamer controls pages and raid order. Updates return to page one.",
    embeds: [
      {
        title: "Raids",
        description: `Page ${pageNumber} · Showing ${snapshot.raids.length} of ${snapshot.raidCount} raids (up to ${BOARD_PAGE_SIZE}).`,
        fields:
          snapshot.raids.length === 0
            ? [{ name: "No raids", value: "No raid is waiting or active.", inline: false }]
            : snapshot.raids.map((raid, index) =>
                boardRaidField(
                  raid,
                  (pageNumber - 1) * BOARD_PAGE_SIZE + index,
                  input.guildId,
                  input.staffChannelId,
                ),
              ),
      },
    ],
    allowed_mentions: { parse: [] },
    components,
  };
  const size =
    message.embeds?.reduce(
      (total, embed) =>
        total +
        embed.title.length +
        embed.description.length +
        embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0),
      0,
    ) ?? 0;
  if (
    size > 6000 ||
    message.embeds?.some((embed) =>
      embed.fields.some((field) => field.name.length > 256 || field.value.length > 1024),
    )
  ) {
    throw new Error("The raid board exceeds Discord embed limits.");
  }
  return message;
}

export function renderRaidMessage(
  raid: StaffBoardRaid,
  notificationUserId?: string,
  pullSource?: PullRequesterSource,
): DiscordBotMessage {
  const terminal = raid.state === "completed" || raid.state === "canceled";
  const status = raidStatus(raid);
  const fields = raidRequesterFields(raid);
  let components: ActionRow[] = [];
  if (raid.state === "planned") {
    components = plannedRaidControls(raid);
  } else if (!terminal) {
    components = activeRaidControls(raid);
  }
  components.push(...pullRequesterControls(raid, pullSource), ...requesterControls(raid));
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
  source: PullRequesterSource,
): DiscordBotMessage {
  return {
    content: `Choose one requester to pull into the ${raidName(destination)} raid.`,
    allowed_mentions: { parse: [] },
    components: pullRequesterControls(destination, source),
  };
}

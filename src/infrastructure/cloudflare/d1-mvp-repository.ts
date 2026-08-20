import {
  type QueueCaller,
  type QueueFacts,
  type QueueQueryRepository,
  QUEUE_RAID_EXACT_LIMIT,
  QUEUE_REQUEST_EXACT_LIMIT,
} from "../../domain/queue-queries";
import { gameModeCode, gameModeLabel, type GameMode } from "../../domain/game-mode";
import { orderByModePresence } from "../../domain/mode-presence-order";
import { resolveTarkovMap } from "../../domain/maps/catalog";
import {
  type CreateHelpRequest,
  type CreateHelpRequestOutcome,
  RepositoryInvariantError,
  type UserMapping,
} from "../../domain/sherpa-repository";
import { normalizeTwitchLogin } from "../../domain/user-identity";
import type {
  CallStatus,
  QueueKind,
  StaffBoardMember,
  StaffBoardRaid,
  StaffBoardSnapshot,
} from "../../domain/staff-board";
import type {
  StaffLeaderStatistic,
  StaffStatistics,
  StaffStatisticsRepository,
} from "../../domain/staff-statistics";
import {
  USER_DIRECTORY_PAGE_SIZE,
  type StaffUserDirectoryEntry,
  type StaffUserDirectoryPage,
  type StaffUserDirectoryRepository,
  type UserDirectoryDirection,
} from "../../domain/staff-user-directory";

const PLATFORM = { discord: 0, twitch: 1 } as const;
const LEADER_TYPE = { streamer: 0, volunteer: 1 } as const;
const CALL_STATUS = { pending: 0, sent: 1, failed: 2, not_requested: 3 } as const;
const MEMBER_STATE = { planned: 0, completed: 1, removed: 2 } as const;
const SORT_STEP = 1_000_000;
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;

interface RequestRow {
  id: number;
  state: "waiting" | "planned" | "completed" | "canceled";
}

interface RaidRow {
  gameMode: GameMode;
  id: number;
  queueKind: QueueKind;
  mapId: string;
  state: "planned" | "active" | "completed" | "canceled";
  outcome: "helped" | "not_run" | null;
  requesterCapacity: number;
  sortKey: number;
  leaderDiscordUserId: string | null;
  leaderType: "streamer" | "volunteer" | null;
  automaticFill: number;
  attemptCount: number;
  discordCallStatus: CallStatus;
  twitchCallStatus: CallStatus;
  staffMessageId: string | null;
  memberId: number | null;
  memberState: number | null;
  requestId: number | null;
  twitchLogin: string | null;
  inGameName: string | null;
  discordUserId: string | null;
  objective: string | null;
  notes: string | null;
  memberPosition: number | null;
}

interface CommunityStateRow {
  staffBoardMessageId: string | null;
  priorityRaidCount: number;
  ordinaryRaidCount: number;
}

interface UserMappingRow {
  twitchLogin: string;
  twitchUserId: string | null;
  discordUserId: string | null;
  discordDisplayName: string | null;
  inGameName: string | null;
}

interface StatisticsSummaryRow {
  submittedRequests: number;
  helpedRequests: number;
  openRequests: number;
  canceledRequests: number;
  successfulRaids: number;
}

interface LeaderStatisticRow extends StaffLeaderStatistic {
  creditedLeaderCount: number;
}

interface TwitchReceiptRow {
  replyText: string | null;
  replyToMessageId: string | null;
  replyStatus: "pending" | "sent" | "failed" | null;
}

interface WaitingRow {
  gameMode: number;
  requestId: number;
  mapId: string;
  isPriority: number;
}

interface OpenGroupRow {
  gameMode: number;
  groupId: number;
  mapId: string;
  isPriority: number;
  sortKey: number;
  requesterCapacity: number;
  memberCount: number;
}

interface MaterializedGroup extends OpenGroupRow {
  actionKey?: string;
}

interface QueueSelectionRow {
  gameMode: GameMode;
  requestId: number;
  mapId: string;
  isPriority: number;
  groupId: number | null;
  sortKey: number | null;
}

interface QueueRaidOrderRow {
  gameMode: GameMode;
  groupId: number;
  isPriority: number;
  sortKey: number;
}

interface RequesterFollowUpWindow {
  sourceSortKey: number;
  anchorSortKey: number;
  nextSortKey: number | null;
  followUpCount: number;
  reusableGroupId: number | null;
}

interface PullBoundaryRow {
  automaticFill: number;
  currentMemberCount: number;
  groupId: number;
  leaderDiscordUserId: string | null;
  requesterCapacity: number;
  staffMessageId: string | null;
  state: "planned" | "active";
}

export interface PullRequesterCandidates {
  source: StaffBoardRaid;
}

export interface PullRequesterResult {
  destination: StaffBoardRaid;
  sourceDisposition: "closed" | "pushed" | "retained";
  pushTarget?: StaffBoardRaid;
}

function epoch(date: Date): number {
  return date.getTime();
}

function requestProjection(): string {
  return `id, 'C' || id AS reference, id AS queueSequence,
          CASE state WHEN 0 THEN 'waiting' WHEN 1 THEN 'planned'
                     WHEN 2 THEN 'completed' ELSE 'canceled' END AS state`;
}

function mapRaidRows(rows: readonly RaidRow[]): StaffBoardRaid[] {
  const raids = new Map<number, StaffBoardRaid>();
  for (const row of rows) {
    let raid = raids.get(row.id);
    if (raid === undefined) {
      raid = {
        gameMode: row.gameMode,
        id: row.id,
        queueKind: row.queueKind,
        mapId: row.mapId,
        state: row.state,
        ...(row.outcome === null ? {} : { outcome: row.outcome }),
        requesterCapacity: row.requesterCapacity,
        sortKey: row.sortKey,
        ...(row.leaderDiscordUserId === null
          ? {}
          : { leaderDiscordUserId: row.leaderDiscordUserId }),
        ...(row.leaderType === null ? {} : { leaderType: row.leaderType }),
        automaticFill: row.automaticFill === 1,
        attemptCount: row.attemptCount,
        discordCallStatus: row.discordCallStatus,
        twitchCallStatus: row.twitchCallStatus,
        ...(row.staffMessageId === null ? {} : { staffMessageId: row.staffMessageId }),
        members: [],
      };
      raids.set(row.id, raid);
    }
    const includeMember =
      row.memberId !== null &&
      row.requestId !== null &&
      row.twitchLogin !== null &&
      row.inGameName !== null &&
      row.objective !== null &&
      row.memberPosition !== null &&
      (raid.state === "planned" || raid.state === "active"
        ? row.memberState === MEMBER_STATE.planned
        : raid.outcome === "helped"
          ? row.memberState === MEMBER_STATE.completed
          : row.memberState !== MEMBER_STATE.removed);
    if (includeMember) {
      const member: StaffBoardMember = {
        id: row.memberId as number,
        requestId: row.requestId as number,
        twitchLogin: row.twitchLogin as string,
        inGameName: row.inGameName as string,
        ...(row.discordUserId === null ? {} : { discordUserId: row.discordUserId }),
        objective: row.objective as string,
        ...(row.notes === null ? {} : { notes: row.notes }),
        position: row.memberPosition as number,
      };
      raid.members.push(member);
    }
  }
  return [...raids.values()];
}

function raidSelectSql(where: string): string {
  return `SELECT raid.id,
                 CASE raid.game_mode WHEN 0 THEN 'pvp-seasonal'
                      WHEN 1 THEN 'pvp' ELSE 'pve' END AS gameMode,
                 CASE raid.is_priority WHEN 1 THEN 'priority' ELSE 'ordinary' END AS queueKind,
                 raid.map_id AS mapId,
                 CASE raid.state WHEN 0 THEN 'planned' WHEN 1 THEN 'active'
                                 WHEN 2 THEN 'completed' ELSE 'canceled' END AS state,
                 CASE raid.outcome WHEN 0 THEN 'helped' WHEN 1 THEN 'not_run' END AS outcome,
                 raid.requester_capacity AS requesterCapacity,
                 raid.sort_key AS sortKey,
                 raid.leader_discord_user_id AS leaderDiscordUserId,
                 CASE raid.leader_type WHEN 0 THEN 'streamer' WHEN 1 THEN 'volunteer' END AS leaderType,
                 raid.automatic_fill AS automaticFill, raid.attempt_count AS attemptCount,
                 CASE raid.discord_call_status WHEN 0 THEN 'pending' WHEN 1 THEN 'sent'
                   WHEN 2 THEN 'failed' ELSE 'not_requested' END AS discordCallStatus,
                 CASE raid.twitch_call_status WHEN 0 THEN 'pending' WHEN 1 THEN 'sent'
                   WHEN 2 THEN 'failed' ELSE 'not_requested' END AS twitchCallStatus,
                 raid.staff_message_id AS staffMessageId,
                 member.id AS memberId, member.state AS memberState,
                 member.request_id AS requestId, request.twitch_login AS twitchLogin,
                 request.in_game_name AS inGameName,
                 coalesce(request.discord_user_id, mapping.discord_user_id) AS discordUserId,
                 request.objective, request.notes, member.position AS memberPosition
          FROM raid_groups AS raid
          LEFT JOIN raid_group_members AS member ON member.group_id = raid.id
          LEFT JOIN help_requests AS request ON request.id = member.request_id
          LEFT JOIN user_mappings AS mapping ON mapping.twitch_login = request.twitch_login
          ${where}
          ORDER BY raid.is_priority DESC, raid.sort_key, member.position`;
}

function boundedModeRaidSql(isPriority: number, limit: number): string {
  const perMode = (gameMode: number) => `
    SELECT id AS groupId,
           CASE game_mode WHEN 0 THEN 'pvp-seasonal' WHEN 1 THEN 'pvp' ELSE 'pve' END AS gameMode,
           is_priority AS isPriority,
           sort_key AS sortKey
    FROM raid_groups
    WHERE is_priority = ${isPriority} AND game_mode = ${gameMode} AND state IN (0, 1)
    ORDER BY sort_key LIMIT ${limit}`;
  return `SELECT groupId, gameMode, isPriority, sortKey FROM (${perMode(0)})
          UNION ALL SELECT groupId, gameMode, isPriority, sortKey FROM (${perMode(1)})
          UNION ALL SELECT groupId, gameMode, isPriority, sortKey FROM (${perMode(2)})`;
}

function boundedGlobalRaidSql(isPriority: number, limit: number): string {
  return `SELECT id AS groupId,
                 CASE game_mode WHEN 0 THEN 'pvp-seasonal'
                      WHEN 1 THEN 'pvp' ELSE 'pve' END AS gameMode,
                 is_priority AS isPriority, sort_key AS sortKey
          FROM raid_groups
          WHERE is_priority = ${isPriority} AND state IN (0, 1)
          ORDER BY sort_key LIMIT ${limit}`;
}

function boundedBoardRaidSql(): string {
  return `SELECT groupId, gameMode, isPriority, sortKey FROM (${boundedModeRaidSql(1, 3)})
          UNION ALL
          SELECT groupId, gameMode, isPriority, sortKey FROM (${boundedModeRaidSql(0, 7)})`;
}

function pullSourceIdSql(requireStaffMessage = true): string {
  return `WITH destination AS (
            SELECT id, is_priority, game_mode, map_id, sort_key
            FROM raid_groups
            WHERE id = ? AND state = 0 AND automatic_fill = 0
              ${requireStaffMessage ? "AND staff_message_id IS NOT NULL" : ""}
              AND current_member_count < requester_capacity
          ), selected AS (
            SELECT coalesce(
              (SELECT source.id
               FROM raid_groups AS source INDEXED BY raid_groups_pull_source_idx
               WHERE source.is_priority = destination.is_priority
                 AND source.game_mode = destination.game_mode
                 AND source.map_id = destination.map_id
                 AND source.state = 0 AND source.automatic_fill = 1
                 AND source.leader_discord_user_id IS NULL
                 AND source.staff_message_id IS NULL
                 AND source.current_member_count > 0
                 AND source.sort_key > destination.sort_key
               ORDER BY source.sort_key LIMIT 1),
              (SELECT source.id
               FROM raid_groups AS source INDEXED BY raid_groups_pull_source_idx
               WHERE destination.is_priority = 1 AND source.is_priority = 0
                 AND source.game_mode = destination.game_mode
                 AND source.map_id = destination.map_id
                 AND source.state = 0 AND source.automatic_fill = 1
                 AND source.leader_discord_user_id IS NULL
                 AND source.staff_message_id IS NULL
                 AND source.current_member_count > 0
               ORDER BY source.sort_key LIMIT 1)
            ) AS groupId
            FROM destination
          )
          SELECT groupId FROM selected WHERE groupId IS NOT NULL`;
}

export interface TwitchReplyReceipt {
  duplicate: boolean;
  replyText: string;
  replyToMessageId?: string;
  replyStatus: "pending" | "sent" | "failed";
}

export class D1MvpRepository
  implements QueueQueryRepository, StaffStatisticsRepository, StaffUserDirectoryRepository
{
  constructor(private readonly database: D1Database) {}

  private async modeFairRaidPrefix(
    isPriority: number,
    exactAheadLimit: number,
  ): Promise<QueueRaidOrderRow[]> {
    const globalLimit = exactAheadLimit + 4;
    const [modeHeads, fifoRows] = await Promise.all([
      this.database.prepare(boundedModeRaidSql(isPriority, 1)).all<QueueRaidOrderRow>(),
      this.database.prepare(boundedGlobalRaidSql(isPriority, globalLimit)).all<QueueRaidOrderRow>(),
    ]);
    const unique = new Map<number, QueueRaidOrderRow>();
    for (const raid of [...modeHeads.results, ...fifoRows.results]) unique.set(raid.groupId, raid);
    return orderByModePresence([...unique.values()]).slice(0, exactAheadLimit + 1);
  }

  async createRequest(input: CreateHelpRequest): Promise<CreateHelpRequestOutcome> {
    if (input.discordUserId === undefined && input.twitchUserId === undefined) {
      throw new RepositoryInvariantError("a request requires a Discord or Twitch caller ID");
    }
    const twitchLogin = normalizeTwitchLogin(input.twitchLogin);
    const objective = input.objective.trim();
    const notes = input.notes?.trim() || undefined;
    if (twitchLogin === undefined)
      throw new RepositoryInvariantError("a request requires a valid Twitch name");
    if (objective.length < 1 || objective.length > 150) {
      throw new RepositoryInvariantError("the request objective must contain 1 to 150 characters");
    }
    if (notes !== undefined && notes.length > 250) {
      throw new RepositoryInvariantError("request notes must contain at most 250 characters");
    }
    const mapping = await this.upsertUserMapping({
      twitchLogin,
      ...(input.twitchUserId === undefined ? {} : { twitchUserId: input.twitchUserId }),
      ...(input.discordUserId === undefined ? {} : { discordUserId: input.discordUserId }),
      ...(input.discordDisplayName === undefined
        ? {}
        : { discordDisplayName: input.discordDisplayName }),
      inGameName: input.inGameName,
      observedAt: input.observedAt,
    });
    const timestamp = epoch(input.observedAt);
    const inserted = await this.database
      .prepare(
        `INSERT OR IGNORE INTO help_requests
           (source_platform, source_delivery_id, discord_user_id, twitch_user_id, twitch_login,
            in_game_name, game_mode, map_id, objective, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${requestProjection()}`,
      )
      .bind(
        PLATFORM[input.sourcePlatform],
        input.sourceDeliveryId,
        input.discordUserId ?? mapping.discordUserId ?? null,
        input.twitchUserId ?? mapping.twitchUserId ?? null,
        twitchLogin,
        input.inGameName.trim(),
        gameModeCode(input.gameMode),
        input.mapId,
        objective,
        notes ?? null,
        timestamp,
        timestamp,
      )
      .first<RequestRow & { reference: string; queueSequence: number }>();
    if (inserted !== null) return { outcome: "created", request: inserted };
    const duplicate = await this.database
      .prepare(
        `SELECT ${requestProjection()} FROM help_requests WHERE source_platform = ? AND source_delivery_id = ?`,
      )
      .bind(PLATFORM[input.sourcePlatform], input.sourceDeliveryId)
      .first<RequestRow & { reference: string; queueSequence: number }>();
    if (duplicate !== null) return { outcome: "duplicate_delivery", request: duplicate };
    const active = await this.database
      .prepare(`SELECT ${requestProjection()} FROM help_requests
                WHERE twitch_login = ? AND game_mode = ? AND map_id = ? AND state IN (0, 1)
                ORDER BY is_priority DESC, id LIMIT 1`)
      .bind(twitchLogin, gameModeCode(input.gameMode), input.mapId)
      .first<RequestRow & { reference: string; queueSequence: number }>();
    if (active === null) throw new RepositoryInvariantError("request was not stored");
    return { outcome: "already_active", request: active };
  }

  private async resolveCallerLogin(caller: QueueCaller): Promise<string | undefined> {
    const column = caller.platform === "discord" ? "discord_user_id" : "twitch_user_id";
    const row = await this.database
      .prepare(`SELECT twitch_login AS twitchLogin FROM user_mappings WHERE ${column} = ?`)
      .bind(caller.userId)
      .first<{ twitchLogin: string }>();
    return row?.twitchLogin;
  }

  async getQueueFacts(caller: QueueCaller): Promise<QueueFacts> {
    const twitchLogin = await this.resolveCallerLogin(caller);
    if (twitchLogin === undefined) return {};
    const selected = await this.database
      .prepare(
        `SELECT request.id AS requestId, request.map_id AS mapId,
                CASE request.game_mode WHEN 0 THEN 'pvp-seasonal'
                     WHEN 1 THEN 'pvp' ELSE 'pve' END AS gameMode,
                request.is_priority AS isPriority, raid.id AS groupId, raid.sort_key AS sortKey
         FROM help_requests AS request
         LEFT JOIN raid_group_members AS member
           ON member.request_id = request.id AND member.state = 0
         LEFT JOIN raid_groups AS raid ON raid.id = member.group_id AND raid.state IN (0, 1)
         WHERE request.twitch_login = ? AND request.state IN (0, 1)
         ORDER BY request.is_priority DESC, request.id LIMIT 1`,
      )
      .bind(twitchLogin)
      .first<QueueSelectionRow>();
    if (selected === null) return {};
    const selectedModeCode = gameModeCode(selected.gameMode);
    const requestPrefix =
      selected.isPriority === 1
        ? this.database
            .prepare(
              `SELECT count(*) AS count FROM (
                 SELECT id FROM help_requests
                 WHERE state IN (0, 1) AND game_mode = ? AND is_priority = 1 AND id < ?
                 ORDER BY id LIMIT ?
               )`,
            )
            .bind(selectedModeCode, selected.requestId, QUEUE_REQUEST_EXACT_LIMIT + 1)
            .first<{ count: number }>()
        : this.database
            .prepare(
              `SELECT count(*) AS count FROM (
                 SELECT id, is_priority AS isPriority FROM help_requests
                 WHERE state IN (0, 1) AND game_mode = ? AND is_priority = 1
                 UNION ALL
                 SELECT id, is_priority AS isPriority FROM help_requests
                 WHERE state IN (0, 1) AND game_mode = ? AND is_priority = 0 AND id < ?
                 ORDER BY isPriority DESC, id LIMIT ?
               )`,
            )
            .bind(
              selectedModeCode,
              selectedModeCode,
              selected.requestId,
              QUEUE_REQUEST_EXACT_LIMIT + 1,
            )
            .first<{ count: number }>();
    const [requestPrefixRow, priorityRaids, otherRows] = await Promise.all([
      requestPrefix,
      this.modeFairRaidPrefix(1, QUEUE_RAID_EXACT_LIMIT),
      this.database
        .prepare(
          `SELECT CASE game_mode WHEN 0 THEN 'pvp-seasonal'
                       WHEN 1 THEN 'pvp' ELSE 'pve' END AS gameMode,
                  map_id AS mapId
           FROM help_requests
           WHERE twitch_login = ? AND state IN (0, 1) AND id <> ?
           GROUP BY game_mode, map_id ORDER BY min(id)`,
        )
        .bind(twitchLogin, selected.requestId)
        .all<{ gameMode: GameMode; mapId: string }>(),
    ]);
    const requestPrefixCount = Number(requestPrefixRow?.count ?? 0);
    const ordinaryAheadLimit =
      selected.isPriority === 1
        ? 0
        : Math.max(
            0,
            QUEUE_RAID_EXACT_LIMIT - Math.min(priorityRaids.length, QUEUE_RAID_EXACT_LIMIT + 1),
          );
    const ordinaryRaids =
      selected.isPriority === 1 ? [] : await this.modeFairRaidPrefix(0, ordinaryAheadLimit);
    const orderedRaids = [...priorityRaids, ...ordinaryRaids];
    const selectedRaidIndex =
      selected.groupId === null
        ? 0
        : orderedRaids.findIndex((raid) => raid.groupId === selected.groupId);
    const raidPrefixCount = selectedRaidIndex < 0 ? QUEUE_RAID_EXACT_LIMIT + 1 : selectedRaidIndex;
    return {
      caller: {
        gameMode: selected.gameMode,
        mapName: resolveTarkovMap(selected.mapId)?.name ?? selected.mapId,
        queuePosition:
          requestPrefixCount > QUEUE_REQUEST_EXACT_LIMIT
            ? { kind: "more_than", requestsAhead: QUEUE_REQUEST_EXACT_LIMIT }
            : { kind: "exact", ordinal: requestPrefixCount + 1 },
        raidsAhead:
          raidPrefixCount > QUEUE_RAID_EXACT_LIMIT
            ? { kind: "more_than", count: QUEUE_RAID_EXACT_LIMIT }
            : { kind: "exact", count: raidPrefixCount },
        otherActiveModeMapNames: otherRows.results.map(
          (row) =>
            `${gameModeLabel(row.gameMode)} · ${resolveTarkovMap(row.mapId)?.name ?? row.mapId}`,
        ),
      },
    };
  }

  private requesterCapacity(mapId: string, recipientLimit: number): number {
    const map = resolveTarkovMap(mapId);
    if (map === undefined) throw new RepositoryInvariantError("a request uses an unsupported map");
    return Math.min(recipientLimit, map.sherpaPartyCapacity - 1);
  }

  async materializeWaitingRequests(input: {
    recipientLimit: number;
    changedAt: Date;
  }): Promise<number> {
    const waiting = await this.database
      .prepare(
        `SELECT id AS requestId, game_mode AS gameMode, map_id AS mapId,
                is_priority AS isPriority
         FROM help_requests WHERE state = 0
         ORDER BY is_priority DESC, id`,
      )
      .all<WaitingRow>();
    if (waiting.results.length === 0) return 0;

    const [existing, maxima] = await Promise.all([
      this.database
        .prepare(
          `SELECT raid.id AS groupId, raid.game_mode AS gameMode, raid.map_id AS mapId,
                  raid.is_priority AS isPriority,
                  raid.sort_key AS sortKey, raid.requester_capacity AS requesterCapacity,
                  raid.current_member_count AS memberCount
           FROM raid_groups AS raid
           WHERE raid.state = 0 AND raid.automatic_fill = 1
             AND raid.current_member_count < raid.requester_capacity
           ORDER BY raid.is_priority, raid.game_mode, raid.map_id, raid.sort_key`,
        )
        .all<OpenGroupRow>(),
      this.database
        .prepare(
          `SELECT
             coalesce((SELECT sort_key FROM raid_groups
                       WHERE is_priority = 1 AND state IN (0, 1)
                       ORDER BY sort_key DESC LIMIT 1), 0) AS priorityMax,
             coalesce((SELECT sort_key FROM raid_groups
                       WHERE is_priority = 0 AND state IN (0, 1)
                       ORDER BY sort_key DESC LIMIT 1), 0) AS ordinaryMax`,
        )
        .first<{ priorityMax: number; ordinaryMax: number }>(),
    ]);

    const availableByQueueAndMap = new Map<
      string,
      { groups: MaterializedGroup[]; index: number }
    >();
    for (const row of existing.results) {
      if (row.memberCount >= row.requesterCapacity) continue;
      const key = `${row.isPriority}:${row.gameMode}:${row.mapId}`;
      const bucket = availableByQueueAndMap.get(key) ?? { groups: [], index: 0 };
      bucket.groups.push({ ...row });
      availableByQueueAndMap.set(key, bucket);
    }
    let priorityMax = Number(maxima?.priorityMax ?? 0);
    let ordinaryMax = Number(maxima?.ordinaryMax ?? 0);
    const newGroups: Array<{
      actionKey: string;
      isPriority: number;
      gameMode: number;
      mapId: string;
      capacity: number;
      sortKey: number;
    }> = [];
    const assignments: Array<{
      requestId: number;
      groupId: number | null;
      actionKey: string | null;
      memberPosition: number;
    }> = [];
    for (const request of waiting.results) {
      const bucketKey = `${request.isPriority}:${request.gameMode}:${request.mapId}`;
      const bucket = availableByQueueAndMap.get(bucketKey) ?? { groups: [], index: 0 };
      let group = bucket.groups[bucket.index];
      if (group === undefined) {
        const actionKey = `materialize:${request.requestId}`;
        if (request.isPriority === 1) {
          priorityMax += SORT_STEP;
        } else {
          ordinaryMax += SORT_STEP;
        }
        const sortKey = request.isPriority === 1 ? priorityMax : ordinaryMax;
        group = {
          groupId: 0,
          actionKey,
          gameMode: request.gameMode,
          mapId: request.mapId,
          isPriority: request.isPriority,
          sortKey,
          requesterCapacity: this.requesterCapacity(request.mapId, input.recipientLimit),
          memberCount: 0,
        };
        bucket.groups.push(group);
        availableByQueueAndMap.set(bucketKey, bucket);
        newGroups.push({
          actionKey,
          isPriority: request.isPriority,
          gameMode: request.gameMode,
          mapId: request.mapId,
          capacity: group.requesterCapacity,
          sortKey,
        });
      }
      group.memberCount += 1;
      assignments.push({
        requestId: request.requestId,
        groupId: group.groupId === 0 ? null : group.groupId,
        actionKey: group.actionKey ?? null,
        memberPosition: group.memberCount,
      });
      if (group.memberCount >= group.requesterCapacity) bucket.index += 1;
    }
    const timestamp = epoch(input.changedAt);
    const groupJson = JSON.stringify(newGroups);
    const assignmentJson = JSON.stringify(assignments);
    const results = await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO raid_groups
             (is_priority, game_mode, sort_key, map_id, requester_capacity,
              last_action_key, created_at, updated_at)
           SELECT json_extract(value, '$.isPriority'), json_extract(value, '$.gameMode'),
                  json_extract(value, '$.sortKey'), json_extract(value, '$.mapId'),
                  json_extract(value, '$.capacity'),
                  json_extract(value, '$.actionKey'), ?, ?
           FROM json_each(?)`,
        )
        .bind(timestamp, timestamp, groupJson),
      this.database
        .prepare(
          `INSERT INTO raid_group_members
             (group_id, request_id, position, created_at, updated_at)
           SELECT coalesce(json_extract(item.value, '$.groupId'), raid.id),
                  request.id, json_extract(item.value, '$.memberPosition'), ?, ?
           FROM json_each(?) AS item
           JOIN help_requests AS request
             ON request.id = json_extract(item.value, '$.requestId') AND request.state = 0
           LEFT JOIN raid_groups AS raid
             ON raid.last_action_key = json_extract(item.value, '$.actionKey')
           WHERE coalesce(json_extract(item.value, '$.groupId'), raid.id) IS NOT NULL`,
        )
        .bind(timestamp, timestamp, assignmentJson),
      this.database
        .prepare(
          `UPDATE help_requests SET state = 1, updated_at = ?
           WHERE state = 0 AND id IN (SELECT json_extract(value, '$.requestId') FROM json_each(?))
             AND EXISTS (
               SELECT 1 FROM raid_group_members AS member
               WHERE member.request_id = help_requests.id AND member.state = 0
             )`,
        )
        .bind(timestamp, assignmentJson),
    ]);
    return Number(results[2]?.meta.changes ?? 0);
  }

  async getBoardSnapshot(_now?: Date): Promise<StaffBoardSnapshot> {
    const [state, candidateRows] = await Promise.all([
      this.database
        .prepare(
          `SELECT staff_board_message_id AS staffBoardMessageId,
                priority_open_raid_count AS priorityRaidCount,
                ordinary_open_raid_count AS ordinaryRaidCount
         FROM community_state WHERE community_id = 'butcoffee'`,
        )
        .first<CommunityStateRow>(),
      this.database.prepare(boundedBoardRaidSql()).all<QueueRaidOrderRow>(),
    ]);
    const fallbackCounts =
      state === null
        ? await this.database
            .prepare(
              `SELECT
                 (SELECT count(*) FROM raid_groups
                  WHERE is_priority = 1 AND state IN (0, 1)) AS priorityRaidCount,
                 (SELECT count(*) FROM raid_groups
                  WHERE is_priority = 0 AND state IN (0, 1)) AS ordinaryRaidCount`,
            )
            .first<{ priorityRaidCount: number; ordinaryRaidCount: number }>()
        : undefined;
    const priorityCandidates = orderByModePresence(
      candidateRows.results.filter((raid) => raid.isPriority === 1),
    ).slice(0, 3);
    const ordinaryCandidates = orderByModePresence(
      candidateRows.results.filter((raid) => raid.isPriority === 0),
    ).slice(0, 7);
    const visibleIds = [...priorityCandidates, ...ordinaryCandidates].map(
      (candidate) => candidate.groupId,
    );
    const detailRows =
      visibleIds.length === 0
        ? { results: [] as RaidRow[] }
        : await this.database
            .prepare(raidSelectSql(`WHERE raid.id IN (${visibleIds.map(() => "?").join(", ")})`))
            .bind(...visibleIds)
            .all<RaidRow>();
    const raidsById = new Map(mapRaidRows(detailRows.results).map((raid) => [raid.id, raid]));
    const hydrate = (candidates: readonly QueueRaidOrderRow[]) =>
      candidates.flatMap((candidate) => {
        const raid = raidsById.get(candidate.groupId);
        return raid === undefined ? [] : [raid];
      });
    return {
      priorityRaidCount: Number(state?.priorityRaidCount ?? fallbackCounts?.priorityRaidCount ?? 0),
      ordinaryRaidCount: Number(state?.ordinaryRaidCount ?? fallbackCounts?.ordinaryRaidCount ?? 0),
      ...(state?.staffBoardMessageId == null
        ? {}
        : { canonicalMessageId: state.staffBoardMessageId }),
      priorityRaids: hydrate(priorityCandidates),
      ordinaryRaids: hydrate(ordinaryCandidates),
    };
  }

  async getRaid(groupId: number): Promise<StaffBoardRaid | undefined> {
    const rows = await this.database
      .prepare(raidSelectSql("WHERE raid.id = ?"))
      .bind(groupId)
      .all<RaidRow>();
    return mapRaidRows(rows.results)[0];
  }

  async setCanonicalBoardMessage(input: { messageId: string; changedAt: Date }): Promise<void> {
    const timestamp = epoch(input.changedAt);
    await this.database
      .prepare(
        `INSERT INTO community_state (community_id, staff_board_message_id, created_at, updated_at)
       VALUES ('butcoffee', ?, ?, ?)
       ON CONFLICT(community_id) DO UPDATE SET
         staff_board_message_id = excluded.staff_board_message_id, updated_at = excluded.updated_at`,
      )
      .bind(input.messageId, timestamp, timestamp)
      .run();
  }

  async reviewRaid(input: { groupId: number; changedAt: Date }): Promise<StaffBoardRaid> {
    const result = await this.database
      .prepare(
        `UPDATE raid_groups SET automatic_fill = 0, updated_at = ?
         WHERE id = ? AND state = 0 AND current_member_count > 0`,
      )
      .bind(epoch(input.changedAt), input.groupId)
      .run();
    if (Number(result.meta.changes) !== 1) {
      throw new RepositoryInvariantError("That raid is no longer available to review.");
    }
    const raid = await this.getRaid(input.groupId);
    if (raid === undefined) throw new RepositoryInvariantError("The reviewed raid was not found.");
    return raid;
  }

  async getPullRequesterCandidates(
    destinationGroupId: number,
    options: { requireStaffMessage?: boolean } = {},
  ): Promise<PullRequesterCandidates | undefined> {
    const selected = await this.database
      .prepare(pullSourceIdSql(options.requireStaffMessage ?? true))
      .bind(destinationGroupId)
      .first<{ groupId: number }>();
    if (selected === null) return undefined;
    const source = await this.getRaid(selected.groupId);
    if (source === undefined || source.members.length === 0) return undefined;
    return { source };
  }

  private async pullBoundary(source: StaffBoardRaid): Promise<PullBoundaryRow | null> {
    return this.database
      .prepare(
        `SELECT id AS groupId,
                CASE state WHEN 0 THEN 'planned' ELSE 'active' END AS state,
                automatic_fill AS automaticFill,
                current_member_count AS currentMemberCount,
                requester_capacity AS requesterCapacity,
                leader_discord_user_id AS leaderDiscordUserId,
                staff_message_id AS staffMessageId
         FROM raid_groups
         WHERE is_priority = ? AND game_mode = ? AND map_id = ?
           AND state IN (0, 1) AND sort_key > ?
         ORDER BY sort_key LIMIT 1`,
      )
      .bind(
        source.queueKind === "priority" ? 1 : 0,
        gameModeCode(source.gameMode),
        source.mapId,
        source.sortKey,
      )
      .first<PullBoundaryRow>();
  }

  async pullRequester(input: {
    destinationGroupId: number;
    sourceGroupId: number;
    requestId: number;
    actionKey: string;
    changedAt: Date;
  }): Promise<PullRequesterResult> {
    const [destination, candidates] = await Promise.all([
      this.getRaid(input.destinationGroupId),
      this.getPullRequesterCandidates(input.destinationGroupId),
    ]);
    if (
      destination === undefined ||
      destination.state !== "planned" ||
      destination.automaticFill ||
      destination.staffMessageId === undefined ||
      destination.members.length >= destination.requesterCapacity ||
      candidates?.source.id !== input.sourceGroupId
    ) {
      throw new RepositoryInvariantError(
        "That pull selection is out of date. Review the raid again.",
      );
    }
    const source = candidates.source;
    if (!source.members.some((member) => member.requestId === input.requestId)) {
      throw new RepositoryInvariantError("That requester is no longer available to pull.");
    }
    const remainder = source.members.filter((member) => member.requestId !== input.requestId);
    const remainderIds = remainder.map((member) => member.requestId);
    const remainderJson = JSON.stringify(remainderIds);
    const boundary = remainder.length === 0 ? null : await this.pullBoundary(source);
    const canPush =
      boundary !== null &&
      boundary.state === "planned" &&
      boundary.automaticFill === 1 &&
      boundary.leaderDiscordUserId === null &&
      boundary.staffMessageId === null &&
      boundary.currentMemberCount + remainder.length <= boundary.requesterCapacity;
    const sourceDisposition: PullRequesterResult["sourceDisposition"] =
      remainder.length === 0 ? "closed" : canPush ? "pushed" : "retained";
    const crossQueue = destination.queueKind === "priority" && source.queueKind === "ordinary";
    const timestamp = epoch(input.changedAt);
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `UPDATE raid_group_members SET state = 2, updated_at = ?
           WHERE group_id = ? AND request_id = ? AND state = 0
             AND ? = (${pullSourceIdSql()})`,
        )
        .bind(
          timestamp,
          input.sourceGroupId,
          input.requestId,
          input.sourceGroupId,
          input.destinationGroupId,
        ),
    ];
    if (crossQueue) {
      statements.push(
        this.database
          .prepare(
            `UPDATE help_requests SET is_priority = 1, updated_at = ?
             WHERE id = ? AND state = 1 AND is_priority = 0
               AND EXISTS (
                 SELECT 1 FROM raid_group_members
                 WHERE group_id = ? AND request_id = ? AND state = 2 AND updated_at = ?
               )`,
          )
          .bind(timestamp, input.requestId, input.sourceGroupId, input.requestId, timestamp),
      );
    }
    if (canPush && boundary !== null) {
      statements.push(
        this.database
          .prepare(
            `UPDATE raid_group_members SET state = 2, updated_at = ?
             WHERE group_id = ? AND state = 0
               AND request_id IN (SELECT value FROM json_each(?))`,
          )
          .bind(timestamp, input.sourceGroupId, remainderJson),
        this.database
          .prepare(
            `INSERT INTO raid_group_members
               (group_id, request_id, position, created_at, updated_at)
             SELECT
               CASE WHEN
                 target.id = (
                   SELECT id FROM raid_groups
                   WHERE is_priority = ? AND game_mode = ? AND map_id = ?
                     AND state IN (0, 1) AND sort_key > ?
                   ORDER BY sort_key LIMIT 1
                 )
                 AND target.state = 0 AND target.automatic_fill = 1
                 AND target.leader_discord_user_id IS NULL
                 AND target.staff_message_id IS NULL
                 AND target.current_member_count + json_array_length(?) <= target.requester_capacity
                 AND (
                   SELECT count(*) FROM raid_group_members AS removed
                   JOIN json_each(?) AS expected ON expected.value = removed.request_id
                   WHERE removed.group_id = ? AND removed.state = 2 AND removed.updated_at = ?
                 ) = json_array_length(?)
               THEN target.id ELSE NULL END,
               item.value,
               (SELECT coalesce(max(position), 0) FROM raid_group_members
                WHERE group_id = target.id AND state = 0) + CAST(item.key AS INTEGER) + 1,
               ?, ?
             FROM json_each(?) AS item
             JOIN raid_groups AS target ON target.id = ?`,
          )
          .bind(
            source.queueKind === "priority" ? 1 : 0,
            gameModeCode(source.gameMode),
            source.mapId,
            source.sortKey,
            remainderJson,
            remainderJson,
            input.sourceGroupId,
            timestamp,
            remainderJson,
            timestamp,
            timestamp,
            remainderJson,
            boundary.groupId,
          ),
      );
    }
    if (sourceDisposition !== "retained") {
      statements.push(
        this.database
          .prepare(
            `UPDATE raid_groups SET state = 3, outcome = 1, staff_message_id = NULL,
                    last_action_key = ?, completed_at = ?, updated_at = ?
             WHERE id = ? AND state = 0 AND automatic_fill = 1
               AND leader_discord_user_id IS NULL AND staff_message_id IS NULL
               AND current_member_count = 0`,
          )
          .bind(input.actionKey, timestamp, timestamp, input.sourceGroupId),
      );
    } else {
      statements.push(
        this.database
          .prepare(
            `UPDATE raid_groups SET last_action_key = ?, updated_at = ?
             WHERE id = ? AND state = 0 AND automatic_fill = 1
               AND leader_discord_user_id IS NULL AND staff_message_id IS NULL
               AND current_member_count = ?`,
          )
          .bind(input.actionKey, timestamp, input.sourceGroupId, remainder.length),
      );
    }
    statements.push(
      this.database
        .prepare(`UPDATE raid_groups SET updated_at = ? WHERE id = ?`)
        .bind(timestamp, input.destinationGroupId),
    );

    const sourceStateAssertion =
      sourceDisposition === "retained"
        ? `source.state = 0 AND source.automatic_fill = 1
           AND source.leader_discord_user_id IS NULL AND source.staff_message_id IS NULL
           AND source.current_member_count = ?
           AND (SELECT count(*) FROM raid_group_members AS current
                JOIN json_each(?) AS expected ON expected.value = current.request_id
                WHERE current.group_id = source.id AND current.state = 0) = json_array_length(?)`
        : `source.state = 3 AND source.outcome = 1 AND source.current_member_count = 0`;
    const sourceStateBindings: unknown[] =
      sourceDisposition === "retained" ? [remainder.length, remainderJson, remainderJson] : [];
    const pushAssertion =
      sourceDisposition === "pushed" && boundary !== null
        ? `AND (SELECT count(*) FROM raid_group_members AS pushed
                JOIN json_each(?) AS expected ON expected.value = pushed.request_id
                WHERE pushed.group_id = ? AND pushed.state = 0) = json_array_length(?)`
        : "";
    const pushBindings: unknown[] =
      sourceDisposition === "pushed" && boundary !== null
        ? [remainderJson, boundary.groupId, remainderJson]
        : [];
    const retainedBoundaryAssertion =
      sourceDisposition !== "retained"
        ? ""
        : boundary === null
          ? `AND NOT EXISTS (
               SELECT 1 FROM raid_groups AS next
               WHERE next.is_priority = source.is_priority
                 AND next.game_mode = source.game_mode AND next.map_id = source.map_id
                 AND next.state IN (0, 1) AND next.sort_key > source.sort_key
             )`
          : `AND ? = (
               SELECT id FROM raid_groups AS next
               WHERE next.is_priority = source.is_priority
                 AND next.game_mode = source.game_mode AND next.map_id = source.map_id
                 AND next.state IN (0, 1) AND next.sort_key > source.sort_key
               ORDER BY next.sort_key LIMIT 1
             )
             AND EXISTS (
               SELECT 1 FROM raid_groups AS boundary
               WHERE boundary.id = ? AND (
                 boundary.state <> 0 OR boundary.automatic_fill <> 1
                 OR boundary.leader_discord_user_id IS NOT NULL
                 OR boundary.staff_message_id IS NOT NULL
                 OR boundary.current_member_count + ? > boundary.requester_capacity
               )
             )`;
    const retainedBoundaryBindings: unknown[] =
      sourceDisposition === "retained" && boundary !== null
        ? [boundary.groupId, boundary.groupId, remainder.length]
        : [];
    statements.push(
      this.database
        .prepare(
          `INSERT INTO raid_group_members
             (group_id, request_id, position, created_at, updated_at)
           SELECT
             CASE WHEN
               destination.state = 0 AND destination.automatic_fill = 0
               AND destination.staff_message_id IS NOT NULL
               AND destination.current_member_count < destination.requester_capacity
               AND destination.game_mode = source.game_mode
               AND destination.map_id = source.map_id
               AND request.state = 1 AND request.game_mode = destination.game_mode
               AND request.map_id = destination.map_id
               AND request.is_priority = destination.is_priority
               AND ${sourceStateAssertion}
               AND EXISTS (
                 SELECT 1 FROM raid_group_members AS removed
                 WHERE removed.group_id = source.id AND removed.request_id = request.id
                   AND removed.state = 2 AND removed.updated_at = ?
               )
               ${pushAssertion}
               ${retainedBoundaryAssertion}
             THEN destination.id ELSE NULL END,
             request.id,
             (SELECT coalesce(max(position), 0) + 1 FROM raid_group_members
              WHERE group_id = destination.id AND state = 0),
             ?, ?
           FROM raid_groups AS destination
           JOIN raid_groups AS source ON source.id = ?
           JOIN help_requests AS request ON request.id = ?
           WHERE destination.id = ?`,
        )
        .bind(
          ...sourceStateBindings,
          timestamp,
          ...pushBindings,
          ...retainedBoundaryBindings,
          timestamp,
          timestamp,
          input.sourceGroupId,
          input.requestId,
          input.destinationGroupId,
        ),
    );

    try {
      await this.database.batch(statements);
    } catch {
      throw new RepositoryInvariantError(
        "That pull selection is out of date. Review the raid again.",
      );
    }
    const [updatedDestination, pushTarget] = await Promise.all([
      this.getRaid(input.destinationGroupId),
      sourceDisposition === "pushed" && boundary !== null
        ? this.getRaid(boundary.groupId)
        : Promise.resolve(undefined),
    ]);
    if (updatedDestination === undefined) {
      throw new RepositoryInvariantError("The requester pull was not stored.");
    }
    return {
      destination: updatedDestination,
      sourceDisposition,
      ...(pushTarget === undefined ? {} : { pushTarget }),
    };
  }

  async startRaid(input: {
    groupId: number;
    leaderDiscordUserId: string;
    leaderType: "streamer" | "volunteer";
    requestTwitchCall: boolean;
    canOverrideReservedLeader?: boolean;
    changedAt: Date;
  }): Promise<StaffBoardRaid> {
    const timestamp = epoch(input.changedAt);
    const result = await this.database
      .prepare(
        `UPDATE raid_groups SET state = 1, leader_discord_user_id = ?, leader_type = ?,
         attempt_count = 1, discord_call_status = 0, twitch_call_status = ?,
         started_at = ?, updated_at = ?
         WHERE id = ? AND state = 0 AND automatic_fill = 0 AND staff_message_id IS NOT NULL
           AND (leader_discord_user_id IS NULL OR leader_discord_user_id = ? OR ? = 1)`,
      )
      .bind(
        input.leaderDiscordUserId,
        LEADER_TYPE[input.leaderType],
        input.requestTwitchCall ? CALL_STATUS.pending : CALL_STATUS.not_requested,
        timestamp,
        timestamp,
        input.groupId,
        input.leaderDiscordUserId,
        input.canOverrideReservedLeader === true ? 1 : 0,
      )
      .run();
    if (Number(result.meta.changes) !== 1)
      throw new RepositoryInvariantError("That raid is no longer available to start.");
    const raid = await this.getRaid(input.groupId);
    if (raid === undefined) throw new RepositoryInvariantError("The started raid was not found.");
    return raid;
  }

  async updateCallStatus(
    groupId: number,
    platform: "discord" | "twitch",
    status: Extract<CallStatus, "sent" | "failed">,
    changedAt: Date,
  ): Promise<void> {
    const column = platform === "discord" ? "discord_call_status" : "twitch_call_status";
    await this.database
      .prepare(`UPDATE raid_groups SET ${column} = ?, updated_at = ? WHERE id = ?`)
      .bind(CALL_STATUS[status], epoch(changedAt), groupId)
      .run();
  }

  async setRaidStaffMessage(groupId: number, messageId: string, changedAt: Date): Promise<void> {
    await this.database
      .prepare(`UPDATE raid_groups SET staff_message_id = ?, updated_at = ? WHERE id = ?`)
      .bind(messageId, epoch(changedAt), groupId)
      .run();
  }

  async compareAndSetRaidStaffMessage(input: {
    groupId: number;
    expectedMessageId?: string;
    messageId?: string;
    changedAt: Date;
  }): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE raid_groups SET staff_message_id = ?, updated_at = ?
       WHERE id = ? AND state IN (0, 1) AND (state = 1 OR automatic_fill = 0)
         AND staff_message_id IS ?`,
      )
      .bind(
        input.messageId ?? null,
        epoch(input.changedAt),
        input.groupId,
        input.expectedMessageId ?? null,
      )
      .run();
    return Number(result.meta.changes) === 1;
  }

  async dismissRaidReview(input: {
    groupId: number;
    expectedMessageId: string;
    changedAt: Date;
  }): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE raid_groups SET staff_message_id = NULL, updated_at = ?
         WHERE id = ? AND state = 0 AND automatic_fill = 0 AND staff_message_id = ?`,
      )
      .bind(epoch(input.changedAt), input.groupId, input.expectedMessageId)
      .run();
    return Number(result.meta.changes) === 1;
  }

  async recordRaidResult(input: {
    groupId: number;
    outcome: "helped" | "unsuccessful";
    attemptLimit: number;
    actionKey: string;
    changedAt: Date;
  }): Promise<StaffBoardRaid> {
    const raid = await this.getRaid(input.groupId);
    if (raid === undefined || raid.state !== "active")
      throw new RepositoryInvariantError("That raid is no longer active.");
    const timestamp = epoch(input.changedAt);
    if (input.outcome === "unsuccessful") {
      if (raid.attemptCount >= input.attemptLimit)
        throw new RepositoryInvariantError("Choose Helped or Postpone raid for the final attempt.");
      const result = await this.database
        .prepare(
          `UPDATE raid_groups SET attempt_count = attempt_count + 1, last_action_key = ?, updated_at = ?
         WHERE id = ? AND state = 1 AND attempt_count < ?`,
        )
        .bind(input.actionKey, timestamp, input.groupId, input.attemptLimit)
        .run();
      if (result.meta.changes !== 1)
        throw new RepositoryInvariantError("That attempt was already recorded.");
    } else {
      const results = await this.database.batch([
        this.database
          .prepare(
            `UPDATE raid_group_members SET state = 1, updated_at = ? WHERE group_id = ? AND state = 0`,
          )
          .bind(timestamp, input.groupId),
        this.database
          .prepare(
            `UPDATE help_requests SET state = 2, updated_at = ?
           WHERE state = 1 AND id IN (
             SELECT request_id FROM raid_group_members WHERE group_id = ? AND state = 1
           )`,
          )
          .bind(timestamp, input.groupId),
        this.database
          .prepare(
            `UPDATE raid_groups SET state = 2, outcome = 0, staff_message_id = NULL,
             last_action_key = ?, completed_at = ?, updated_at = ?
           WHERE id = ? AND state = 1`,
          )
          .bind(input.actionKey, timestamp, timestamp, input.groupId),
      ]);
      if (Number(results[2]?.meta.changes ?? 0) < 1)
        throw new RepositoryInvariantError("That raid result was already recorded.");
    }
    const updated = await this.getRaid(input.groupId);
    if (updated === undefined)
      throw new RepositoryInvariantError("The raid result was not stored.");
    return updated;
  }

  private async requesterFollowUpWindow(groupId: number): Promise<RequesterFollowUpWindow | null> {
    return this.database
      .prepare(
        `WITH source AS (
           SELECT id, is_priority, game_mode, sort_key, map_id
           FROM raid_groups WHERE id = ? AND state IN (0, 1)
         ),
         follow_ups AS (
           SELECT DISTINCT target.id, target.sort_key, target.state, target.automatic_fill,
                  target.current_member_count, target.requester_capacity
           FROM source
           JOIN raid_group_members AS source_member
             ON source_member.group_id = source.id AND source_member.state = 2
           JOIN raid_group_members AS target_member
             ON target_member.request_id = source_member.request_id AND target_member.state = 0
           JOIN raid_groups AS target ON target.id = target_member.group_id
           WHERE target.id <> source.id AND target.is_priority = source.is_priority
             AND target.game_mode = source.game_mode
             AND target.map_id = source.map_id AND target.state IN (0, 1)
         ),
         bounds AS (
           SELECT source.is_priority AS isPriority, source.sort_key AS sourceSortKey,
                  coalesce(max(follow_ups.sort_key), source.sort_key) AS anchorSortKey,
                  count(follow_ups.id) AS followUpCount
           FROM source LEFT JOIN follow_ups ON true
           GROUP BY source.is_priority, source.sort_key
         )
         SELECT bounds.sourceSortKey, bounds.anchorSortKey, bounds.followUpCount,
                (SELECT min(next.sort_key) FROM raid_groups AS next
                 WHERE next.is_priority = bounds.isPriority AND next.state IN (0, 1)
                   AND next.sort_key > bounds.anchorSortKey) AS nextSortKey,
                (SELECT id FROM follow_ups
                 WHERE state = 0 AND automatic_fill = 1
                   AND current_member_count < requester_capacity
                 ORDER BY sort_key LIMIT 1) AS reusableGroupId
         FROM bounds`,
      )
      .bind(groupId)
      .first<RequesterFollowUpWindow>();
  }

  async postponeRequester(input: {
    groupId: number;
    requestId: number;
    actionKey: string;
    changedAt: Date;
  }): Promise<{ source: StaffBoardRaid; dedicated: StaffBoardRaid }> {
    const source = await this.getRaid(input.groupId);
    const isReviewedPlanned =
      source?.state === "planned" && !source.automaticFill && source.staffMessageId !== undefined;
    if (source === undefined || (source.state !== "active" && !isReviewedPlanned))
      throw new RepositoryInvariantError("That raid is no longer available.");
    if (!source.members.some((member) => member.requestId === input.requestId))
      throw new RepositoryInvariantError("That requester is no longer in this raid.");
    const sourceBecomesEmpty = source.members.length === 1;
    const window = await this.requesterFollowUpWindow(input.groupId);
    if (window === null) throw new RepositoryInvariantError("That raid is no longer available.");
    const reusableGroupId = window.reusableGroupId;
    const followUpSortKey =
      sourceBecomesEmpty && window.followUpCount === 0
        ? window.sourceSortKey
        : window.nextSortKey === null
          ? window.anchorSortKey + SORT_STEP
          : Math.floor((window.anchorSortKey + window.nextSortKey) / 2);
    const timestamp = epoch(input.changedAt);
    const followUpAction = `${input.actionKey}:postponed`;
    const sourceUpdate = this.database
      .prepare(
        `UPDATE raid_groups SET
         state = CASE WHEN ? = 1 THEN 3 ELSE state END,
         outcome = CASE WHEN ? = 1 THEN 1 ELSE outcome END,
         staff_message_id = CASE WHEN ? = 1 THEN NULL ELSE staff_message_id END,
         completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END,
         last_action_key = ?, updated_at = ?
       WHERE id = ? AND state IN (0, 1) AND EXISTS (
         SELECT 1 FROM raid_group_members
         WHERE group_id = ? AND request_id = ? AND state = 0
       )`,
      )
      .bind(
        sourceBecomesEmpty ? 1 : 0,
        sourceBecomesEmpty ? 1 : 0,
        sourceBecomesEmpty ? 1 : 0,
        sourceBecomesEmpty ? 1 : 0,
        timestamp,
        input.actionKey,
        timestamp,
        input.groupId,
        input.groupId,
        input.requestId,
      );
    const removeSourceMembership = this.database
      .prepare(
        `UPDATE raid_group_members SET state = 2, updated_at = ?
       WHERE group_id = ? AND request_id = ? AND state = 0`,
      )
      .bind(timestamp, input.groupId, input.requestId);
    const statements = [sourceUpdate];
    if (reusableGroupId === null) {
      statements.push(
        this.database
          .prepare(
            `INSERT INTO raid_groups
             (is_priority, game_mode, sort_key, map_id, requester_capacity,
              leader_discord_user_id, leader_type, automatic_fill,
              last_action_key, created_at, updated_at)
           SELECT is_priority, game_mode, ?, map_id, requester_capacity,
                  leader_discord_user_id, leader_type, 1, ?, ?, ?
           FROM raid_groups WHERE id = ? AND last_action_key = ?`,
          )
          .bind(
            followUpSortKey,
            followUpAction,
            timestamp,
            timestamp,
            input.groupId,
            input.actionKey,
          ),
      );
    }
    statements.push(removeSourceMembership);
    const destinationPredicate = reusableGroupId === null ? "last_action_key = ?" : "id = ?";
    const destinationKey = reusableGroupId ?? followUpAction;
    statements.push(
      this.database
        .prepare(
          `INSERT INTO raid_group_members
             (group_id, request_id, position, created_at, updated_at)
           VALUES (
             (SELECT id FROM raid_groups
              WHERE ${destinationPredicate} AND state = 0 AND automatic_fill = 1
                AND current_member_count < requester_capacity),
             (SELECT id FROM help_requests WHERE id = ? AND state = 1),
             (SELECT current_member_count + 1 FROM raid_groups
              WHERE ${destinationPredicate} AND state = 0 AND automatic_fill = 1
                AND current_member_count < requester_capacity),
             ?, ?
           )`,
        )
        .bind(destinationKey, input.requestId, destinationKey, timestamp, timestamp),
    );
    const results = await this.database.batch(statements);
    if (results.some((result) => Number(result.meta.changes) < 1)) {
      throw new RepositoryInvariantError("The requester was not postponed atomically.");
    }
    const destinationId =
      reusableGroupId === null
        ? await this.database
            .prepare(`SELECT id FROM raid_groups WHERE last_action_key = ?`)
            .bind(followUpAction)
            .first<{ id: number }>()
        : { id: reusableGroupId };
    const [updatedSource, dedicated] = await Promise.all([
      this.getRaid(input.groupId),
      destinationId === null ? undefined : this.getRaid(destinationId.id),
    ]);
    if (updatedSource === undefined || dedicated === undefined)
      throw new RepositoryInvariantError("The postponed raid state was not found.");
    return { source: updatedSource, dedicated };
  }

  async removeRequester(input: {
    groupId: number;
    requestId: number;
    actionKey: string;
    changedAt: Date;
  }): Promise<StaffBoardRaid> {
    const source = await this.getRaid(input.groupId);
    const isReviewedPlanned =
      source?.state === "planned" && !source.automaticFill && source.staffMessageId !== undefined;
    if (source === undefined || (source.state !== "active" && !isReviewedPlanned))
      throw new RepositoryInvariantError("That raid is no longer available.");
    if (!source.members.some((member) => member.requestId === input.requestId))
      throw new RepositoryInvariantError("That requester is no longer in this raid.");
    const timestamp = epoch(input.changedAt);
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE raid_group_members SET state = 2, updated_at = ? WHERE group_id = ? AND request_id = ? AND state = 0`,
        )
        .bind(timestamp, input.groupId, input.requestId),
      this.database
        .prepare(`UPDATE help_requests SET state = 3, updated_at = ? WHERE id = ? AND state = 1`)
        .bind(timestamp, input.requestId),
      this.database
        .prepare(
          `UPDATE raid_groups SET state = 3, outcome = 1, staff_message_id = NULL,
           last_action_key = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND state IN (0, 1) AND NOT EXISTS (
           SELECT 1 FROM raid_group_members WHERE group_id = ? AND state = 0
         )`,
        )
        .bind(input.actionKey, timestamp, timestamp, input.groupId, input.groupId),
      this.database
        .prepare(
          `UPDATE raid_groups SET last_action_key = ?, updated_at = ? WHERE id = ? AND state IN (0, 1)`,
        )
        .bind(input.actionKey, timestamp, input.groupId),
    ]);
    const updated = await this.getRaid(input.groupId);
    if (updated === undefined)
      throw new RepositoryInvariantError("The requester removal was not stored.");
    return updated;
  }

  async postponeRaid(input: {
    groupId: number;
    actionKey: string;
    changedAt: Date;
  }): Promise<StaffBoardRaid> {
    const source = await this.getRaid(input.groupId);
    if (source === undefined || source.state !== "active")
      throw new RepositoryInvariantError("That raid is no longer active.");
    if (source.members.length === 0)
      throw new RepositoryInvariantError("That raid has no requesters to postpone.");
    const timestamp = epoch(input.changedAt);
    const results = await this.database.batch([
      this.database
        .prepare(
          `UPDATE help_requests SET is_priority = 1, updated_at = ?
         WHERE state = 1 AND id IN (
           SELECT request_id FROM raid_group_members WHERE group_id = ? AND state = 0
         )`,
        )
        .bind(timestamp, input.groupId),
      this.database
        .prepare(
          `UPDATE raid_groups SET is_priority = 1,
           sort_key = coalesce((SELECT max(target.sort_key) FROM raid_groups AS target
                                WHERE target.is_priority = 1 AND target.state IN (0, 1)), 0) + ?,
           state = 0, automatic_fill = 0, attempt_count = 0,
           discord_call_status = 3, twitch_call_status = 3,
           staff_message_id = NULL, last_action_key = ?, started_at = NULL, updated_at = ?
         WHERE id = ? AND state = 1`,
        )
        .bind(SORT_STEP, input.actionKey, timestamp, input.groupId),
    ]);
    if (Number(results[1]?.meta.changes ?? 0) < 1)
      throw new RepositoryInvariantError("That raid is no longer active.");
    const updated = await this.getRaid(input.groupId);
    if (updated === undefined)
      throw new RepositoryInvariantError("The postponed raid state was not found.");
    return updated;
  }

  async upsertUserMapping(input: {
    twitchLogin: string;
    twitchUserId?: string;
    discordUserId?: string;
    discordDisplayName?: string;
    inGameName?: string;
    observedAt: Date;
  }): Promise<UserMapping> {
    const twitchLogin = normalizeTwitchLogin(input.twitchLogin);
    if (twitchLogin === undefined) throw new RepositoryInvariantError("Enter a valid Twitch name.");
    if (input.twitchUserId === undefined && input.discordUserId === undefined)
      throw new RepositoryInvariantError("A user mapping requires a Twitch or Discord caller ID.");
    const timestamp = epoch(input.observedAt);
    const statements: D1PreparedStatement[] = [];
    if (input.twitchUserId !== undefined) {
      statements.push(
        this.database
          .prepare(
            `UPDATE user_mappings SET twitch_user_id = NULL, updated_at = ?
         WHERE twitch_user_id = ? AND twitch_login <> ?`,
          )
          .bind(timestamp, input.twitchUserId, twitchLogin),
      );
    }
    if (input.discordUserId !== undefined) {
      statements.push(
        this.database
          .prepare(
            `UPDATE user_mappings SET discord_user_id = NULL, discord_display_name = NULL, updated_at = ?
         WHERE discord_user_id = ? AND twitch_login <> ?`,
          )
          .bind(timestamp, input.discordUserId, twitchLogin),
      );
    }
    statements.push(
      this.database
        .prepare(
          `INSERT INTO user_mappings
         (twitch_login, twitch_user_id, discord_user_id, discord_display_name,
          in_game_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(twitch_login) DO UPDATE SET
         twitch_user_id = coalesce(excluded.twitch_user_id, user_mappings.twitch_user_id),
         discord_user_id = coalesce(excluded.discord_user_id, user_mappings.discord_user_id),
         discord_display_name = coalesce(excluded.discord_display_name, user_mappings.discord_display_name),
         in_game_name = CASE
           WHEN excluded.in_game_name IS NULL THEN user_mappings.in_game_name
           WHEN user_mappings.in_game_name IS NULL OR excluded.discord_user_id IS NOT NULL
             THEN excluded.in_game_name ELSE user_mappings.in_game_name END,
         updated_at = excluded.updated_at`,
        )
        .bind(
          twitchLogin,
          input.twitchUserId ?? null,
          input.discordUserId ?? null,
          input.discordDisplayName ?? null,
          input.inGameName?.trim() || null,
          timestamp,
          timestamp,
        ),
    );
    await this.database.batch(statements);
    const row = await this.database
      .prepare(
        `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
              discord_user_id AS discordUserId, discord_display_name AS discordDisplayName,
              in_game_name AS inGameName FROM user_mappings WHERE twitch_login = ?`,
      )
      .bind(twitchLogin)
      .first<UserMappingRow>();
    if (row === null) throw new RepositoryInvariantError("User mapping was not stored.");
    return {
      twitchLogin: row.twitchLogin,
      ...(row.twitchUserId === null ? {} : { twitchUserId: row.twitchUserId }),
      ...(row.discordUserId === null ? {} : { discordUserId: row.discordUserId }),
      ...(row.discordDisplayName === null ? {} : { discordDisplayName: row.discordDisplayName }),
      ...(row.inGameName === null ? {} : { inGameName: row.inGameName }),
    };
  }

  async findUserMappingByDiscordId(discordUserId: string): Promise<UserMapping | undefined> {
    const row = await this.database
      .prepare(
        `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
              discord_user_id AS discordUserId, discord_display_name AS discordDisplayName,
              in_game_name AS inGameName FROM user_mappings WHERE discord_user_id = ?`,
      )
      .bind(discordUserId)
      .first<UserMappingRow>();
    return row === null
      ? undefined
      : {
          twitchLogin: row.twitchLogin,
          ...(row.twitchUserId === null ? {} : { twitchUserId: row.twitchUserId }),
          ...(row.discordUserId === null ? {} : { discordUserId: row.discordUserId }),
          ...(row.discordDisplayName === null
            ? {}
            : { discordDisplayName: row.discordDisplayName }),
          ...(row.inGameName === null ? {} : { inGameName: row.inGameName }),
        };
  }

  async getStaffStatistics(): Promise<StaffStatistics> {
    const results = await this.database.batch([
      this.database.prepare(
        `SELECT count(*) AS submittedRequests,
                coalesce(sum(state = 2), 0) AS helpedRequests,
                coalesce(sum(state IN (0, 1)), 0) AS openRequests,
                coalesce(sum(state = 3), 0) AS canceledRequests,
                (SELECT count(*) FROM raid_groups WHERE state = 2 AND outcome = 0)
                  AS successfulRaids
         FROM help_requests`,
      ),
      this.database.prepare(
        `WITH credits AS (
           SELECT raid.leader_discord_user_id AS discordUserId,
                  count(member.id) AS helpedRequests,
                  count(DISTINCT raid.id) AS successfulRaids
           FROM raid_groups AS raid
           JOIN raid_group_members AS member
             ON member.group_id = raid.id AND member.state = 1
           WHERE raid.state = 2 AND raid.outcome = 0
             AND raid.leader_discord_user_id IS NOT NULL
           GROUP BY raid.leader_discord_user_id
         )
         SELECT discordUserId, helpedRequests, successfulRaids,
                count(*) OVER () AS creditedLeaderCount
         FROM credits
         ORDER BY helpedRequests DESC, successfulRaids DESC, discordUserId ASC
         LIMIT 10`,
      ),
    ]);
    const summary = results[0]?.results[0] as StatisticsSummaryRow | undefined;
    const leaders = (results[1]?.results ?? []) as unknown as LeaderStatisticRow[];
    const creditedLeaderCount = Number(leaders[0]?.creditedLeaderCount ?? 0);
    return {
      submittedRequests: Number(summary?.submittedRequests ?? 0),
      helpedRequests: Number(summary?.helpedRequests ?? 0),
      openRequests: Number(summary?.openRequests ?? 0),
      canceledRequests: Number(summary?.canceledRequests ?? 0),
      successfulRaids: Number(summary?.successfulRaids ?? 0),
      leaders: leaders.map((leader) => ({
        discordUserId: leader.discordUserId,
        helpedRequests: Number(leader.helpedRequests),
        successfulRaids: Number(leader.successfulRaids),
      })),
      omittedLeaderCount: Math.max(0, creditedLeaderCount - leaders.length),
    };
  }

  async getUserDirectoryPage(input: {
    direction: UserDirectoryDirection;
    cursor?: string;
  }): Promise<StaffUserDirectoryPage> {
    const reverse = input.direction === "previous";
    const comparator = reverse ? "<" : ">";
    const order = reverse ? "DESC" : "ASC";
    const boundary =
      input.direction === "first"
        ? ""
        : input.direction === "at"
          ? "WHERE twitch_login >= ?"
          : `WHERE twitch_login ${comparator} ?`;
    let statement = this.database.prepare(
      `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
              discord_user_id AS discordUserId, discord_display_name AS discordDisplayName,
              in_game_name AS inGameName
       FROM user_mappings ${boundary}
       ORDER BY twitch_login ${order} LIMIT ?`,
    );
    statement =
      input.direction === "first"
        ? statement.bind(USER_DIRECTORY_PAGE_SIZE + 1)
        : statement.bind(input.cursor, USER_DIRECTORY_PAGE_SIZE + 1);
    const result = await statement.all<UserMappingRow>();
    const hasRowsBeforeCursor =
      input.direction === "at" && input.cursor !== undefined
        ? Number(
            (
              await this.database
                .prepare(
                  `SELECT EXISTS(
                     SELECT 1 FROM user_mappings WHERE twitch_login < ?
                   ) AS present`,
                )
                .bind(input.cursor)
                .first<{ present: number }>()
            )?.present ?? 0,
          ) === 1
        : undefined;
    const lookahead = result.results.length > USER_DIRECTORY_PAGE_SIZE;
    const selected = result.results.slice(0, USER_DIRECTORY_PAGE_SIZE);
    if (reverse) selected.reverse();
    const entries = selected.map(
      (row): StaffUserDirectoryEntry => ({
        twitchLogin: row.twitchLogin,
        twitchIdentityObserved: row.twitchUserId !== null,
        ...(row.twitchUserId === null ? {} : { twitchUserId: row.twitchUserId }),
        ...(row.discordUserId === null ? {} : { discordUserId: row.discordUserId }),
        ...(row.discordDisplayName === null ? {} : { discordDisplayName: row.discordDisplayName }),
        ...(row.inGameName === null ? {} : { inGameName: row.inGameName }),
      }),
    );
    return {
      entries,
      hasPrevious:
        input.direction === "first"
          ? false
          : input.direction === "at"
            ? (hasRowsBeforeCursor ?? false)
            : reverse
              ? lookahead
              : true,
      hasNext: input.direction === "first" ? lookahead : reverse ? true : lookahead,
    };
  }

  async findUserMappingByTwitchLogin(
    twitchLogin: string,
  ): Promise<StaffUserDirectoryEntry | undefined> {
    const normalized = normalizeTwitchLogin(twitchLogin);
    if (normalized === undefined) return undefined;
    const row = await this.database
      .prepare(
        `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
                discord_user_id AS discordUserId, discord_display_name AS discordDisplayName,
                in_game_name AS inGameName FROM user_mappings WHERE twitch_login = ?`,
      )
      .bind(normalized)
      .first<UserMappingRow>();
    return row === null
      ? undefined
      : {
          twitchLogin: row.twitchLogin,
          twitchIdentityObserved: row.twitchUserId !== null,
          ...(row.twitchUserId === null ? {} : { twitchUserId: row.twitchUserId }),
          ...(row.discordUserId === null ? {} : { discordUserId: row.discordUserId }),
          ...(row.discordDisplayName === null
            ? {}
            : { discordDisplayName: row.discordDisplayName }),
          ...(row.inGameName === null ? {} : { inGameName: row.inGameName }),
        };
  }

  async completeMissingDiscord(input: {
    twitchLogin: string;
    discordUserId: string;
    discordDisplayName?: string;
    changedAt: Date;
  }): Promise<"updated" | "stale"> {
    const normalized = normalizeTwitchLogin(input.twitchLogin);
    if (normalized === undefined) return "stale";
    const result = await this.database
      .prepare(
        `UPDATE user_mappings
         SET discord_user_id = ?, discord_display_name = ?, updated_at = ?
         WHERE twitch_login = ? AND discord_user_id IS NULL`,
      )
      .bind(
        input.discordUserId,
        input.discordDisplayName ?? null,
        epoch(input.changedAt),
        normalized,
      )
      .run();
    return result.meta.changes === 1 ? "updated" : "stale";
  }

  async completeMissingInGameName(input: {
    twitchLogin: string;
    inGameName: string;
    changedAt: Date;
  }): Promise<"updated" | "stale"> {
    const normalized = normalizeTwitchLogin(input.twitchLogin);
    const inGameName = input.inGameName.trim();
    if (normalized === undefined || inGameName.length < 1 || inGameName.length > 64) return "stale";
    const result = await this.database
      .prepare(
        `UPDATE user_mappings SET in_game_name = ?, updated_at = ?
         WHERE twitch_login = ? AND in_game_name IS NULL`,
      )
      .bind(inGameName, epoch(input.changedAt), normalized)
      .run();
    return result.meta.changes === 1 ? "updated" : "stale";
  }

  observeTwitchIdentity(input: {
    twitchLogin: string;
    twitchUserId: string;
    observedAt: Date;
  }): Promise<UserMapping> {
    return this.upsertUserMapping(input);
  }

  linkDiscordToTwitch(input: {
    twitchLogin: string;
    discordUserId: string;
    discordDisplayName?: string;
    inGameName?: string;
    linkedAt: Date;
  }): Promise<UserMapping> {
    return this.upsertUserMapping({
      twitchLogin: input.twitchLogin,
      discordUserId: input.discordUserId,
      ...(input.discordDisplayName === undefined
        ? {}
        : { discordDisplayName: input.discordDisplayName }),
      ...(input.inGameName === undefined ? {} : { inGameName: input.inGameName }),
      observedAt: input.linkedAt,
    });
  }

  async recordTwitchReply(input: {
    deliveryId: string;
    eventType: string;
    replyText: string;
    replyToMessageId?: string;
    receivedAt: Date;
  }): Promise<TwitchReplyReceipt> {
    const receivedAt = epoch(input.receivedAt);
    const results = await this.database.batch([
      this.database
        .prepare(`DELETE FROM event_receipts WHERE received_at < ?`)
        .bind(receivedAt - RECEIPT_TTL_MS),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO event_receipts
           (platform, delivery_id, event_type, received_at, twitch_reply_text,
            twitch_reply_to_message_id, reply_status)
         VALUES (1, ?, ?, ?, ?, ?, 0)`,
        )
        .bind(
          input.deliveryId,
          input.eventType,
          receivedAt,
          input.replyText,
          input.replyToMessageId ?? null,
        ),
    ]);
    const row = await this.database
      .prepare(
        `SELECT twitch_reply_text AS replyText, twitch_reply_to_message_id AS replyToMessageId,
              CASE reply_status WHEN 0 THEN 'pending' WHEN 1 THEN 'sent'
                                WHEN 2 THEN 'failed' END AS replyStatus
       FROM event_receipts WHERE platform = 1 AND delivery_id = ?`,
      )
      .bind(input.deliveryId)
      .first<TwitchReceiptRow>();
    if (row?.replyText == null || row.replyStatus === null)
      throw new RepositoryInvariantError("Twitch command receipt was not stored");
    return {
      duplicate: results[1]?.meta.changes === 0,
      replyText: row.replyText,
      replyStatus: row.replyStatus,
      ...(row.replyToMessageId === null ? {} : { replyToMessageId: row.replyToMessageId }),
    };
  }

  async markTwitchReplySent(deliveryId: string, platformMessageId: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE event_receipts SET reply_status = 1, reply_attempts = reply_attempts + 1,
         platform_message_id = ?, last_error_code = NULL WHERE platform = 1 AND delivery_id = ?`,
      )
      .bind(platformMessageId, deliveryId)
      .run();
  }

  async markTwitchReplyFailed(deliveryId: string, errorCode: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE event_receipts SET reply_status = 2, reply_attempts = reply_attempts + 1,
         last_error_code = ? WHERE platform = 1 AND delivery_id = ?`,
      )
      .bind(errorCode, deliveryId)
      .run();
  }

  async claimDiscordMutation(
    deliveryId: string,
    eventType: string,
    receivedAt: Date,
  ): Promise<boolean> {
    const timestamp = epoch(receivedAt);
    const results = await this.database.batch([
      this.database
        .prepare(`DELETE FROM event_receipts WHERE received_at < ?`)
        .bind(timestamp - RECEIPT_TTL_MS),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO event_receipts (platform, delivery_id, event_type, received_at)
         VALUES (0, ?, ?, ?)`,
        )
        .bind(deliveryId, eventType, timestamp),
    ]);
    return results[1]?.meta.changes === 1;
  }

  async getDiagnostics(): Promise<{
    tableCount: number;
    requestCount: number;
    receiptCount: number;
  }> {
    const results = await this.database.batch([
      this.database.prepare(
        `SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
      ),
      this.database.prepare(`SELECT count(*) AS count FROM help_requests`),
      this.database.prepare(`SELECT count(*) AS count FROM event_receipts`),
    ]);
    const count = (index: number) =>
      Number((results[index]?.results[0] as { count?: number } | undefined)?.count ?? 0);
    return { tableCount: count(0), requestCount: count(1), receiptCount: count(2) };
  }
}

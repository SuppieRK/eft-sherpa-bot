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
  StableTwitchIdentityConflictError,
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
const RECEIPT_CLEANUP_BATCH_SIZE = 100;
const RECEIPT_CLEANUP_INTERVAL_MS = 15 * 60 * 1_000;
const DISCORD_MUTATION_CLAIM_MS = 5 * 60 * 1_000;
const TWITCH_COMMAND_CLAIM_MS = 2 * 60 * 1_000;
export const BOARD_DRAIN_LEASE_MS = 30 * 1_000;
const BOARD_PRIORITY_RAID_LIMIT = 3;
const BOARD_ORDINARY_RAID_LIMIT = 7;
const MAX_REQUESTERS_PER_RAID = 4;
const MATERIALIZATION_BOARD_LOOKAHEAD = 2;
const MATERIALIZATION_BATCH_SIZE =
  (BOARD_PRIORITY_RAID_LIMIT + BOARD_ORDINARY_RAID_LIMIT) *
  MAX_REQUESTERS_PER_RAID *
  MATERIALIZATION_BOARD_LOOKAHEAD;

interface RequestRow {
  id: number;
  state: "waiting" | "planned" | "completed" | "canceled";
}

interface SelectedRequestRow extends RequestRow {
  reference: string;
  queueSequence: number;
  sourceDeliveryId: string;
  sourcePlatform: number;
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
  boardDirtyVersion: number;
}

export interface BoardDrainLease {
  dirtyVersion: number;
  renderedVersion: number;
  token: string;
  canonicalMessageId?: string;
}

interface UserMappingRow {
  twitchLogin: string;
  twitchUserId: string | null;
  discordUserId: string | null;
  discordDisplayName: string | null;
  inGameName: string | null;
  twitchObservedAt?: number;
}

function directoryEntry(row: UserMappingRow): StaffUserDirectoryEntry {
  return {
    twitchLogin: row.twitchLogin,
    twitchIdentityObserved: row.twitchUserId !== null,
    ...(row.twitchUserId === null ? {} : { twitchUserId: row.twitchUserId }),
    ...(row.discordUserId === null ? {} : { discordUserId: row.discordUserId }),
    ...(row.discordDisplayName === null ? {} : { discordDisplayName: row.discordDisplayName }),
    ...(row.inGameName === null ? {} : { inGameName: row.inGameName }),
  };
}

interface StatisticsSummaryRow {
  submittedRequests: number;
  helpedRequests: number;
  openRequests: number;
  canceledRequests: number;
  successfulRaids: number;
  creditedLeaderCount: number;
}

type LeaderStatisticRow = StaffLeaderStatistic;

interface TwitchReceiptRow {
  replyText: string | null;
  replyToMessageId: string | null;
  replyStatus: "pending" | "sent" | "failed" | null;
  processingUntil: number | null;
  processingToken: string | null;
  sendToken: string | null;
}

function twitchReplyReceipt(row: TwitchReceiptRow): TwitchReplyReceipt {
  if (row.replyText === null || row.replyStatus === null) {
    throw new RepositoryInvariantError("The Twitch reply is not ready.");
  }
  return {
    replyText: row.replyText,
    replyStatus: row.replyStatus,
    sendClaimed: row.sendToken !== null,
    ...(row.replyToMessageId === null ? {} : { replyToMessageId: row.replyToMessageId }),
  };
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
  plannedAssignmentCount: number;
}

interface NewMaterializedGroup {
  anchorRequestId: number;
  actionKey: string;
  isPriority: number;
  gameMode: number;
  mapId: string;
  capacity: number;
  sortKey: number;
}

interface MaterializedAssignment {
  requestId: number;
  groupId: number | null;
  actionKey: string | null;
  positionOffset: number;
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
  isPriority: number;
  sourceSortKey: number;
  anchorSortKey: number;
  nextSortKey: number | null;
  followUpCount: number;
  reusableGroupId: number | null;
}

interface PostponeRequesterInput {
  groupId: number;
  requestId: number;
  actionKey: string;
  changedAt: Date;
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

interface PullRequesterInput {
  destinationGroupId: number;
  sourceGroupId: number;
  requestId: number;
  actionKey: string;
  changedAt: Date;
}

interface PullRequesterPlan {
  destination: StaffBoardRaid;
  source: StaffBoardRaid;
  remainder: StaffBoardMember[];
  remainderJson: string;
  boundary: PullBoundaryRow | null;
  canPush: boolean;
  sourceDisposition: PullRequesterResult["sourceDisposition"];
  crossQueue: boolean;
  timestamp: number;
}

function epoch(date: Date): number {
  return date.getTime();
}

function requesterFollowUpSortKey(
  sourceBecomesEmpty: boolean,
  window: RequesterFollowUpWindow,
): number {
  if (sourceBecomesEmpty && window.followUpCount === 0) return window.sourceSortKey;
  if (window.nextSortKey === null) return window.anchorSortKey + SORT_STEP;
  return Math.floor((window.anchorSortKey + window.nextSortKey) / 2);
}

function requestProjection(): string {
  return `id, 'C' || id AS reference, id AS queueSequence,
          CASE state WHEN 0 THEN 'waiting' WHEN 1 THEN 'planned'
                     WHEN 2 THEN 'completed' ELSE 'canceled' END AS state`;
}

function raidFromRow(row: RaidRow): StaffBoardRaid {
  return {
    gameMode: row.gameMode,
    id: row.id,
    queueKind: row.queueKind,
    mapId: row.mapId,
    state: row.state,
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    requesterCapacity: row.requesterCapacity,
    sortKey: row.sortKey,
    ...(row.leaderDiscordUserId === null ? {} : { leaderDiscordUserId: row.leaderDiscordUserId }),
    ...(row.leaderType === null ? {} : { leaderType: row.leaderType }),
    automaticFill: row.automaticFill === 1,
    attemptCount: row.attemptCount,
    discordCallStatus: row.discordCallStatus,
    twitchCallStatus: row.twitchCallStatus,
    ...(row.staffMessageId === null ? {} : { staffMessageId: row.staffMessageId }),
    members: [],
  };
}

function rowMemberMatchesRaid(row: RaidRow, raid: StaffBoardRaid): boolean {
  if (raid.state === "planned" || raid.state === "active") {
    return row.memberState === MEMBER_STATE.planned;
  }
  if (raid.outcome === "helped") {
    return row.memberState === MEMBER_STATE.completed;
  }
  return row.memberState !== MEMBER_STATE.removed;
}

function memberFromRow(row: RaidRow): StaffBoardMember | undefined {
  if (
    row.memberId === null ||
    row.requestId === null ||
    row.twitchLogin === null ||
    row.inGameName === null ||
    row.objective === null ||
    row.memberPosition === null
  ) {
    return undefined;
  }
  return {
    id: row.memberId,
    requestId: row.requestId,
    twitchLogin: row.twitchLogin,
    inGameName: row.inGameName,
    ...(row.discordUserId === null ? {} : { discordUserId: row.discordUserId }),
    objective: row.objective,
    ...(row.notes === null ? {} : { notes: row.notes }),
    position: row.memberPosition,
  };
}

function mapRaidRows(rows: readonly RaidRow[]): StaffBoardRaid[] {
  const raids = new Map<number, StaffBoardRaid>();
  for (const row of rows) {
    let raid = raids.get(row.id);
    if (raid === undefined) {
      raid = raidFromRow(row);
      raids.set(row.id, raid);
    }
    const member = memberFromRow(row);
    if (member !== undefined && rowMemberMatchesRaid(row, raid)) raid.members.push(member);
  }
  return [...raids.values()];
}

function raidSelectSql(where: string, memberState?: number): string {
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
                 member.request_id AS requestId,
                 coalesce(stable_mapping.twitch_login, request.twitch_login) AS twitchLogin,
                 request.in_game_name AS inGameName,
                 coalesce(request.discord_user_id, stable_mapping.discord_user_id,
                          login_mapping.discord_user_id) AS discordUserId,
                 request.objective, request.notes, member.position AS memberPosition
          FROM raid_groups AS raid
          LEFT JOIN raid_group_members AS member
            ON member.group_id = raid.id
           ${memberState === undefined ? "" : `AND member.state = ${memberState}`}
          LEFT JOIN help_requests AS request ON request.id = member.request_id
          LEFT JOIN user_mappings AS stable_mapping
            ON stable_mapping.twitch_user_id = request.twitch_user_id
          LEFT JOIN user_mappings AS login_mapping
            ON login_mapping.twitch_login = request.twitch_login
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
  return `SELECT groupId, gameMode, isPriority, sortKey FROM (${boundedModeRaidSql(1, BOARD_PRIORITY_RAID_LIMIT)})
          UNION ALL
          SELECT groupId, gameMode, isPriority, sortKey FROM (${boundedModeRaidSql(0, BOARD_ORDINARY_RAID_LIMIT)})`;
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

function materializationBucketKey(row: {
  isPriority: number;
  gameMode: number;
  mapId: string;
}): string {
  return `${row.isPriority}:${row.gameMode}:${row.mapId}`;
}

function availableMaterializationGroups(
  rows: readonly OpenGroupRow[],
): Map<string, { groups: MaterializedGroup[]; index: number }> {
  const buckets = new Map<string, { groups: MaterializedGroup[]; index: number }>();
  for (const row of rows) {
    if (row.memberCount >= row.requesterCapacity) continue;
    const key = materializationBucketKey(row);
    const bucket = buckets.get(key) ?? { groups: [], index: 0 };
    bucket.groups.push({ ...row, plannedAssignmentCount: 0 });
    buckets.set(key, bucket);
  }
  return buckets;
}

function nextMaterializationSortKey(
  request: WaitingRow,
  maxima: { priority: number; ordinary: number },
): number {
  if (request.isPriority === 1) {
    maxima.priority += SORT_STEP;
    return maxima.priority;
  }
  maxima.ordinary += SORT_STEP;
  return maxima.ordinary;
}

function createMaterializedGroup(
  request: WaitingRow,
  maxima: { priority: number; ordinary: number },
  capacityForMap: (mapId: string) => number,
): MaterializedGroup {
  return {
    groupId: 0,
    actionKey: `materialize:${request.requestId}`,
    gameMode: request.gameMode,
    mapId: request.mapId,
    isPriority: request.isPriority,
    sortKey: nextMaterializationSortKey(request, maxima),
    requesterCapacity: capacityForMap(request.mapId),
    memberCount: 0,
    plannedAssignmentCount: 0,
  };
}

function planMaterialization(
  waiting: readonly WaitingRow[],
  existing: readonly OpenGroupRow[],
  initialMaxima: { priority: number; ordinary: number },
  capacityForMap: (mapId: string) => number,
): { newGroups: NewMaterializedGroup[]; assignments: MaterializedAssignment[] } {
  const buckets = availableMaterializationGroups(existing);
  const maxima = { ...initialMaxima };
  const newGroups: NewMaterializedGroup[] = [];
  const assignments: MaterializedAssignment[] = [];
  for (const request of waiting) {
    const bucketKey = materializationBucketKey(request);
    const bucket = buckets.get(bucketKey) ?? { groups: [], index: 0 };
    let group = bucket.groups[bucket.index];
    if (group === undefined) {
      group = createMaterializedGroup(request, maxima, capacityForMap);
      bucket.groups.push(group);
      buckets.set(bucketKey, bucket);
      newGroups.push({
        anchorRequestId: request.requestId,
        actionKey: `materialize:${request.requestId}`,
        isPriority: request.isPriority,
        gameMode: request.gameMode,
        mapId: request.mapId,
        capacity: group.requesterCapacity,
        sortKey: group.sortKey,
      });
    }
    group.memberCount += 1;
    group.plannedAssignmentCount += 1;
    assignments.push({
      requestId: request.requestId,
      groupId: group.groupId === 0 ? null : group.groupId,
      actionKey: group.actionKey ?? null,
      positionOffset: group.plannedAssignmentCount,
    });
    if (group.memberCount >= group.requesterCapacity) bucket.index += 1;
  }
  return { newGroups, assignments };
}

export interface TwitchReplyReceipt {
  replyText: string;
  replyToMessageId?: string;
  replyStatus: "pending" | "sent" | "failed";
  sendClaimed: boolean;
}

export type TwitchCommandClaim =
  | { outcome: "claimed"; claimToken: string }
  | { outcome: "processing" }
  | { outcome: "ready"; receipt: TwitchReplyReceipt };

export interface TwitchReplyDeliveryClaim {
  sendToken: string;
  receipt: TwitchReplyReceipt;
}

export class D1MvpRepository
  implements QueueQueryRepository, StaffStatisticsRepository, StaffUserDirectoryRepository
{
  constructor(private readonly database: D1Database) {}

  private async assertNoStableIdentityCollision(
    twitchLogin: string,
    twitchUserId: string,
  ): Promise<void> {
    const target = await this.database
      .prepare(`SELECT twitch_user_id AS twitchUserId FROM user_mappings WHERE twitch_login = ?`)
      .bind(twitchLogin)
      .first<{ twitchUserId: string | null }>();
    if (target?.twitchUserId != null && target.twitchUserId !== twitchUserId) {
      throw new StableTwitchIdentityConflictError(
        "That Twitch login belongs to another verified Twitch identity. Staff must resolve it.",
      );
    }
  }

  private boardDirtyStatement(
    timestamp: number,
    onlyIfPreviousStatementChanged = false,
  ): D1PreparedStatement {
    const values = onlyIfPreviousStatementChanged
      ? "SELECT 'butcoffee', 1, ?, ? WHERE changes() > 0"
      : "VALUES ('butcoffee', 1, ?, ?)";
    return this.database
      .prepare(
        `INSERT INTO community_state
           (community_id, board_dirty_version, created_at, updated_at)
         ${values}
         ON CONFLICT(community_id) DO UPDATE SET
           board_dirty_version = community_state.board_dirty_version + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(timestamp, timestamp);
  }

  private userMappingStatements(input: {
    twitchLogin: string;
    twitchUserId?: string;
    discordUserId?: string;
    discordDisplayName?: string;
    inGameName?: string;
    timestamp: number;
    twitchObservationTimestamp?: number;
  }): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [];
    const twitchObservationTimestamp = input.twitchObservationTimestamp ?? 0;
    if (input.twitchUserId !== undefined) {
      statements.push(
        this.database
          .prepare(
            `UPDATE user_mappings
             SET twitch_login = ?, twitch_observed_at = ?, updated_at = ?
             WHERE twitch_user_id = ? AND twitch_login <> ?
               AND twitch_observed_at <= ?
               AND NOT EXISTS (
                 SELECT 1 FROM user_mappings AS target WHERE target.twitch_login = ?
               )`,
          )
          .bind(
            input.twitchLogin,
            twitchObservationTimestamp,
            input.timestamp,
            input.twitchUserId,
            input.twitchLogin,
            twitchObservationTimestamp,
            input.twitchLogin,
          ),
        this.database
          .prepare(
            `UPDATE user_mappings SET twitch_user_id = NULL, updated_at = ?
             WHERE twitch_user_id = ? AND twitch_login <> ? AND twitch_observed_at <= ?`,
          )
          .bind(input.timestamp, input.twitchUserId, input.twitchLogin, twitchObservationTimestamp),
      );
    }
    if (input.discordUserId !== undefined) {
      statements.push(
        this.database
          .prepare(
            `UPDATE user_mappings
             SET discord_user_id = NULL, discord_display_name = NULL, updated_at = ?
             WHERE discord_user_id = ? AND twitch_login <> ?`,
          )
          .bind(input.timestamp, input.discordUserId, input.twitchLogin),
      );
    }
    statements.push(
      this.database
        .prepare(
          `INSERT INTO user_mappings
             (twitch_login, twitch_user_id, discord_user_id, discord_display_name,
              in_game_name, created_at, updated_at, twitch_observed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(twitch_login) DO UPDATE SET
             twitch_user_id = CASE
               WHEN excluded.twitch_user_id IS NULL THEN user_mappings.twitch_user_id
               WHEN user_mappings.twitch_observed_at <= excluded.twitch_observed_at
                 THEN excluded.twitch_user_id ELSE user_mappings.twitch_user_id END,
             discord_user_id = coalesce(excluded.discord_user_id, user_mappings.discord_user_id),
             discord_display_name = coalesce(excluded.discord_display_name, user_mappings.discord_display_name),
             in_game_name = CASE
               WHEN excluded.in_game_name IS NULL THEN user_mappings.in_game_name
               WHEN user_mappings.in_game_name IS NULL OR excluded.discord_user_id IS NOT NULL
                 THEN excluded.in_game_name ELSE user_mappings.in_game_name END,
             twitch_observed_at = CASE WHEN excluded.twitch_user_id IS NULL
               THEN user_mappings.twitch_observed_at
               ELSE max(user_mappings.twitch_observed_at, excluded.twitch_observed_at) END,
             updated_at = max(user_mappings.updated_at, excluded.updated_at)
           WHERE user_mappings.twitch_user_id IS NOT
                   CASE
                     WHEN excluded.twitch_user_id IS NULL THEN user_mappings.twitch_user_id
                     WHEN user_mappings.twitch_observed_at <= excluded.twitch_observed_at
                       THEN excluded.twitch_user_id ELSE user_mappings.twitch_user_id END
              OR user_mappings.discord_user_id IS NOT
                   coalesce(excluded.discord_user_id, user_mappings.discord_user_id)
              OR user_mappings.discord_display_name IS NOT
                   coalesce(excluded.discord_display_name, user_mappings.discord_display_name)
              OR user_mappings.in_game_name IS NOT CASE
                   WHEN excluded.in_game_name IS NULL THEN user_mappings.in_game_name
                   WHEN user_mappings.in_game_name IS NULL OR excluded.discord_user_id IS NOT NULL
                     THEN excluded.in_game_name ELSE user_mappings.in_game_name END
              OR (excluded.twitch_user_id IS NOT NULL
                  AND user_mappings.twitch_observed_at < excluded.twitch_observed_at)`,
        )
        .bind(
          input.twitchLogin,
          input.twitchUserId ?? null,
          input.discordUserId ?? null,
          input.discordDisplayName ?? null,
          input.inGameName?.trim() || null,
          input.timestamp,
          input.timestamp,
          twitchObservationTimestamp,
        ),
    );
    return statements;
  }

  private async modeFairRaidPrefix(
    isPriority: number,
    exactAheadLimit: number,
  ): Promise<QueueRaidOrderRow[]> {
    const globalLimit = exactAheadLimit + 4;
    const [modeHeads, fifoRows] = await this.database.batch<QueueRaidOrderRow>([
      this.database.prepare(boundedModeRaidSql(isPriority, 1)),
      this.database.prepare(boundedGlobalRaidSql(isPriority, globalLimit)),
    ]);
    const unique = new Map<number, QueueRaidOrderRow>();
    for (const raid of [...(modeHeads?.results ?? []), ...(fifoRows?.results ?? [])]) {
      unique.set(raid.groupId, raid);
    }
    return orderByModePresence([...unique.values()]).slice(0, exactAheadLimit + 1);
  }

  async createRequest(input: CreateHelpRequest): Promise<CreateHelpRequestOutcome> {
    if (input.discordUserId === undefined && input.twitchUserId === undefined) {
      throw new RepositoryInvariantError("a request requires a Discord or Twitch caller ID");
    }
    let twitchLogin = normalizeTwitchLogin(input.twitchLogin);
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
    if (!Number.isInteger(input.recipientLimit) || input.recipientLimit < 1) {
      throw new RepositoryInvariantError("recipient limit must be a positive integer");
    }
    const requesterCapacity = this.requesterCapacity(input.mapId, input.recipientLimit);
    const timestamp = epoch(input.observedAt);
    const platform = PLATFORM[input.sourcePlatform];
    const actionKey = `intake:${platform}:${input.sourceDeliveryId}`;
    if (input.twitchUserId !== undefined) {
      const stable = await this.database
        .prepare(
          `SELECT twitch_login AS twitchLogin, twitch_observed_at AS twitchObservedAt
           FROM user_mappings WHERE twitch_user_id = ?`,
        )
        .bind(input.twitchUserId)
        .first<{ twitchLogin: string; twitchObservedAt: number }>();
      if (
        input.sourcePlatform === "twitch" &&
        stable !== null &&
        stable.twitchObservedAt > timestamp
      ) {
        twitchLogin = stable.twitchLogin;
      } else {
        await this.assertNoStableIdentityCollision(twitchLogin, input.twitchUserId);
      }
    }
    const statements = this.userMappingStatements({
      twitchLogin,
      ...(input.twitchUserId === undefined ? {} : { twitchUserId: input.twitchUserId }),
      ...(input.discordUserId === undefined ? {} : { discordUserId: input.discordUserId }),
      ...(input.discordDisplayName === undefined
        ? {}
        : { discordDisplayName: input.discordDisplayName }),
      inGameName: input.inGameName,
      timestamp,
      ...(input.sourcePlatform === "twitch" && input.twitchUserId !== undefined
        ? { twitchObservationTimestamp: timestamp }
        : {}),
    });
    const requestInsertIndex = statements.length;
    statements.push(
      this.database
        .prepare(
          `INSERT OR IGNORE INTO help_requests
           (source_platform, source_delivery_id, discord_user_id, twitch_user_id, twitch_login,
            in_game_name, game_mode, map_id, objective, notes, state, created_at, updated_at)
         VALUES (
           ?, ?,
           coalesce(?, (SELECT discord_user_id FROM user_mappings WHERE twitch_login = ?)),
           coalesce(?, (SELECT twitch_user_id FROM user_mappings WHERE twitch_login = ?)),
           ?, ?, ?, ?, ?, ?, 1, ?, ?
         )
         RETURNING ${requestProjection()}`,
        )
        .bind(
          platform,
          input.sourceDeliveryId,
          input.discordUserId ?? null,
          twitchLogin,
          input.twitchUserId ?? null,
          twitchLogin,
          twitchLogin,
          input.inGameName.trim(),
          gameModeCode(input.gameMode),
          input.mapId,
          objective,
          notes ?? null,
          timestamp,
          timestamp,
        ),
      this.database
        .prepare(
          `/* d1:assignment.intake_group */
           INSERT OR IGNORE INTO raid_groups
             (is_priority, game_mode, sort_key, map_id, requester_capacity,
              last_action_key, created_at, updated_at)
           SELECT request.is_priority, request.game_mode,
                  coalesce((
                    SELECT max(existing.sort_key) FROM raid_groups AS existing
                    WHERE existing.is_priority = request.is_priority
                      AND existing.state IN (0, 1)
                  ), 0) + ?,
                  request.map_id, ?, ?, ?, ?
           FROM help_requests AS request
           WHERE request.source_platform = ? AND request.source_delivery_id = ?
             AND request.state IN (0, 1)
             AND NOT EXISTS (
               SELECT 1 FROM raid_group_members AS member
               WHERE member.request_id = request.id AND member.state = 0
             )
             AND NOT EXISTS (
               SELECT 1 FROM raid_groups AS eligible
               WHERE eligible.is_priority = request.is_priority
                 AND eligible.game_mode = request.game_mode
                 AND eligible.map_id = request.map_id
                 AND eligible.state = 0 AND eligible.automatic_fill = 1
                 AND eligible.current_member_count < eligible.requester_capacity
             )`,
        )
        .bind(
          SORT_STEP,
          requesterCapacity,
          actionKey,
          timestamp,
          timestamp,
          platform,
          input.sourceDeliveryId,
        ),
    );
    const membershipInsertIndex = statements.length;
    statements.push(
      this.database
        .prepare(
          `/* d1:assignment.intake_membership */
           INSERT OR IGNORE INTO raid_group_members
             (group_id, request_id, position, created_at, updated_at)
           SELECT raid.id, request.id,
                  (SELECT coalesce(max(member.position), 0) + 1
                   FROM raid_group_members AS member
                   WHERE member.group_id = raid.id AND member.state = 0),
                  ?, ?
           FROM help_requests AS request
           JOIN raid_groups AS raid
             ON raid.is_priority = request.is_priority
            AND raid.game_mode = request.game_mode
            AND raid.map_id = request.map_id
            AND raid.state = 0 AND raid.automatic_fill = 1
            AND raid.current_member_count < raid.requester_capacity
           WHERE request.source_platform = ? AND request.source_delivery_id = ?
             AND request.state IN (0, 1)
             AND NOT EXISTS (
               SELECT 1 FROM raid_group_members AS member
               WHERE member.request_id = request.id AND member.state = 0
             )
           ORDER BY raid.sort_key
           LIMIT 1
           RETURNING request_id`,
        )
        .bind(timestamp, timestamp, platform, input.sourceDeliveryId),
      this.boardDirtyStatement(timestamp, true),
      this.database
        .prepare(
          `INSERT INTO raid_group_members
             (group_id, request_id, position, created_at, updated_at)
           SELECT NULL, request.id, 0, ?, ?
           FROM help_requests AS request
           WHERE request.source_platform = ? AND request.source_delivery_id = ?
             AND request.state IN (0, 1)
             AND NOT EXISTS (
               SELECT 1 FROM raid_group_members AS member
               WHERE member.request_id = request.id AND member.state = 0
             )`,
        )
        .bind(timestamp, timestamp, platform, input.sourceDeliveryId),
    );
    const deliverySelectedIndex = statements.length;
    statements.push(
      this.database
        .prepare(
          `SELECT ${requestProjection()}, source_platform AS sourcePlatform,
                  source_delivery_id AS sourceDeliveryId
           FROM help_requests
           WHERE source_platform = ? AND source_delivery_id = ?`,
        )
        .bind(platform, input.sourceDeliveryId),
    );
    const stableSelectedIndex = statements.length;
    statements.push(
      this.database
        .prepare(
          `SELECT ${requestProjection()}, source_platform AS sourcePlatform,
                  source_delivery_id AS sourceDeliveryId
           FROM help_requests
           WHERE twitch_user_id = coalesce(?, (
                   SELECT twitch_user_id FROM user_mappings WHERE twitch_login = ?
                 ))
             AND game_mode = ? AND map_id = ? AND state IN (0, 1)
           ORDER BY is_priority DESC, id LIMIT 1`,
        )
        .bind(input.twitchUserId ?? null, twitchLogin, gameModeCode(input.gameMode), input.mapId),
    );
    const loginSelectedIndex = statements.length;
    statements.push(
      this.database
        .prepare(
          `SELECT ${requestProjection()}, source_platform AS sourcePlatform,
                  source_delivery_id AS sourceDeliveryId
           FROM help_requests
           WHERE twitch_login = ? AND game_mode = ? AND map_id = ? AND state IN (0, 1)
           ORDER BY is_priority DESC, id LIMIT 1`,
        )
        .bind(twitchLogin, gameModeCode(input.gameMode), input.mapId),
    );
    const results = await this.database.batch(statements);
    const request = (results[deliverySelectedIndex]?.results[0] ??
      results[stableSelectedIndex]?.results[0] ??
      results[loginSelectedIndex]?.results[0]) as SelectedRequestRow | undefined;
    if (request === undefined) throw new RepositoryInvariantError("request was not stored");
    const inserted = (results[requestInsertIndex]?.results.length ?? 0) > 0;
    const queueChanged = (results[membershipInsertIndex]?.results.length ?? 0) > 0;
    const record = {
      id: request.id,
      reference: request.reference,
      queueSequence: request.queueSequence,
      state: request.state,
    };
    if (inserted) return { outcome: "created", queueChanged: true, request: record };
    if (
      request.sourcePlatform === platform &&
      request.sourceDeliveryId === input.sourceDeliveryId
    ) {
      return { outcome: "duplicate_delivery", queueChanged, request: record };
    }
    return { outcome: "already_active", queueChanged: false, request: record };
  }

  private async resolveCallerIdentity(
    caller: QueueCaller,
  ): Promise<{ twitchLogin: string; twitchUserId?: string } | undefined> {
    const column = caller.platform === "discord" ? "discord_user_id" : "twitch_user_id";
    const row = await this.database
      .prepare(
        `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId
         FROM user_mappings WHERE ${column} = ?`,
      )
      .bind(caller.userId)
      .first<{ twitchLogin: string; twitchUserId: string | null }>();
    if (row === null) return undefined;
    return {
      twitchLogin: row.twitchLogin,
      ...(row.twitchUserId === null ? {} : { twitchUserId: row.twitchUserId }),
    };
  }

  async getQueueFacts(caller: QueueCaller): Promise<QueueFacts> {
    const identity = await this.resolveCallerIdentity(caller);
    if (identity === undefined) return {};
    const identityPredicate =
      identity.twitchUserId === undefined
        ? { sql: "request.twitch_login = ?", value: identity.twitchLogin }
        : { sql: "request.twitch_user_id = ?", value: identity.twitchUserId };
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
         WHERE ${identityPredicate.sql} AND request.state IN (0, 1)
         ORDER BY request.is_priority DESC, request.id LIMIT 1`,
      )
      .bind(identityPredicate.value)
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
           WHERE ${identityPredicate.sql.replaceAll("request.", "")} AND state IN (0, 1) AND id <> ?
           GROUP BY game_mode, map_id ORDER BY min(id)`,
        )
        .bind(identityPredicate.value, selected.requestId)
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

  async repairLegacyUnassignedRequests(input: {
    recipientLimit: number;
    changedAt: Date;
  }): Promise<{ hasMore: boolean; repaired: number }> {
    let repaired = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remainingBudget = MATERIALIZATION_BATCH_SIZE - repaired;
      if (remainingBudget === 0) break;
      // Concurrent Worker invocations can win a planned assignment. Re-read D1 before retrying.
      // oxlint-disable-next-line no-await-in-loop
      const result = await this.repairLegacyUnassignedRequestsPass(input, remainingBudget);
      repaired += result.materialized;
      if (!result.shouldRetry) break;
    }
    const remaining = await this.database
      .prepare(`SELECT EXISTS(SELECT 1 FROM help_requests WHERE state = 0) AS present`)
      .first<{ present: number }>();
    return { repaired, hasMore: Number(remaining?.present ?? 0) === 1 };
  }

  private async repairLegacyUnassignedRequestsPass(
    input: {
      recipientLimit: number;
      changedAt: Date;
    },
    batchLimit: number,
  ): Promise<{ materialized: number; shouldRetry: boolean }> {
    const fifo = await this.database
      .prepare(
        `SELECT id AS requestId, game_mode AS gameMode, map_id AS mapId,
                is_priority AS isPriority
         FROM help_requests
         WHERE state = 0
         ORDER BY is_priority DESC, id
         LIMIT ?`,
      )
      .bind(batchLimit)
      .all<WaitingRow>();
    if (fifo.results.length === 0) return { materialized: 0, shouldRetry: false };

    let waiting = fifo.results;
    if (fifo.results.length === batchLimit) {
      const heads = await this.database
        .prepare(
          `SELECT request.id AS requestId, request.game_mode AS gameMode,
                  request.map_id AS mapId, request.is_priority AS isPriority
           FROM help_requests AS request
           JOIN json_each(json_array(
             (SELECT id FROM help_requests
              WHERE state = 0 AND is_priority = 1 AND game_mode = 0 ORDER BY id LIMIT 1),
             (SELECT id FROM help_requests
              WHERE state = 0 AND is_priority = 1 AND game_mode = 1 ORDER BY id LIMIT 1),
             (SELECT id FROM help_requests
              WHERE state = 0 AND is_priority = 1 AND game_mode = 2 ORDER BY id LIMIT 1),
             (SELECT id FROM help_requests
              WHERE state = 0 AND is_priority = 0 AND game_mode = 0 ORDER BY id LIMIT 1),
             (SELECT id FROM help_requests
              WHERE state = 0 AND is_priority = 0 AND game_mode = 1 ORDER BY id LIMIT 1),
             (SELECT id FROM help_requests
              WHERE state = 0 AND is_priority = 0 AND game_mode = 2 ORDER BY id LIMIT 1)
           )) AS head ON head.value = request.id
           WHERE head.value IS NOT NULL`,
        )
        .all<WaitingRow>();
      const selected = new Map<number, WaitingRow>();
      const orderedHeads = [...heads.results].sort(
        (left, right) => right.isPriority - left.isPriority || left.requestId - right.requestId,
      );
      for (const row of orderedHeads) {
        if (selected.size === batchLimit) break;
        selected.set(row.requestId, row);
      }
      for (const row of fifo.results) {
        if (selected.size === batchLimit) break;
        selected.set(row.requestId, row);
      }
      waiting = [...selected.values()].sort(
        (left, right) => right.isPriority - left.isPriority || left.requestId - right.requestId,
      );
    }

    const demand = [
      ...waiting
        .reduce((counts, row) => {
          const key = `${row.isPriority}:${row.gameMode}:${row.mapId}`;
          const current = counts.get(key);
          if (current === undefined) {
            counts.set(key, {
              isPriority: row.isPriority,
              gameMode: row.gameMode,
              mapId: row.mapId,
              requestCount: 1,
            });
          } else {
            current.requestCount += 1;
          }
          return counts;
        }, new Map<
          string,
          { isPriority: number; gameMode: number; mapId: string; requestCount: number }
        >())
        .values(),
    ];
    const [existingResults, maxima] = await Promise.all([
      this.database.batch<OpenGroupRow>(
        demand.map((bucket) =>
          this.database
            .prepare(
              `/* d1:assignment.legacy_candidates */
               SELECT id AS groupId, game_mode AS gameMode, map_id AS mapId,
                      is_priority AS isPriority, sort_key AS sortKey,
                      requester_capacity AS requesterCapacity,
                      current_member_count AS memberCount
               FROM raid_groups
               WHERE is_priority = ? AND game_mode = ? AND map_id = ?
                 AND state = 0 AND automatic_fill = 1
                 AND current_member_count < requester_capacity
               ORDER BY sort_key
               LIMIT ?`,
            )
            .bind(bucket.isPriority, bucket.gameMode, bucket.mapId, bucket.requestCount),
        ),
      ),
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

    const { newGroups, assignments } = planMaterialization(
      waiting,
      existingResults.flatMap((result) => result.results),
      {
        priority: Number(maxima?.priorityMax ?? 0),
        ordinary: Number(maxima?.ordinaryMax ?? 0),
      },
      (mapId) => this.requesterCapacity(mapId, input.recipientLimit),
    );
    const timestamp = epoch(input.changedAt);
    const groupJson = JSON.stringify(newGroups);
    const assignmentJson = JSON.stringify(assignments);
    const results = await this.database.batch([
      this.database
        .prepare(
          `/* d1:assignment.legacy_group_insert */
           INSERT OR IGNORE INTO raid_groups
             (is_priority, game_mode, sort_key, map_id, requester_capacity,
              last_action_key, created_at, updated_at)
           SELECT json_extract(value, '$.isPriority'), json_extract(value, '$.gameMode'),
                  json_extract(value, '$.sortKey'), json_extract(value, '$.mapId'),
                  json_extract(value, '$.capacity'),
                  json_extract(value, '$.actionKey'), ?, ?
           FROM json_each(?) AS item
           JOIN help_requests AS request
             ON request.id = json_extract(item.value, '$.anchorRequestId')
            AND request.state = 0`,
        )
        .bind(timestamp, timestamp, groupJson),
      this.database
        .prepare(
          `/* d1:assignment.legacy_membership_insert */
           WITH resolved AS MATERIALIZED (
             SELECT request.id AS request_id,
                    coalesce(json_extract(item.value, '$.groupId'), raid.id) AS group_id,
                    cast(json_extract(item.value, '$.positionOffset') AS INTEGER) AS position_offset
             FROM json_each(?) AS item
             JOIN help_requests AS request
               ON request.id = json_extract(item.value, '$.requestId') AND request.state = 0
             LEFT JOIN raid_groups AS raid
               ON raid.last_action_key = json_extract(item.value, '$.actionKey')
           ), destination AS MATERIALIZED (
             SELECT raid.id, raid.current_member_count, raid.requester_capacity,
                    (SELECT coalesce(max(member.position), 0)
                     FROM raid_group_members AS member
                     WHERE member.group_id = raid.id AND member.state = 0) AS maximum_position
             FROM raid_groups AS raid
             JOIN (SELECT DISTINCT group_id FROM resolved) AS selected
               ON selected.group_id = raid.id
             WHERE raid.state = 0 AND raid.automatic_fill = 1
           )
           INSERT OR IGNORE INTO raid_group_members
             (group_id, request_id, position, created_at, updated_at)
           SELECT resolved.group_id, resolved.request_id,
                  destination.maximum_position + resolved.position_offset, ?, ?
           FROM resolved
           JOIN destination ON destination.id = resolved.group_id
           WHERE resolved.position_offset BETWEEN 1
                 AND destination.requester_capacity - destination.current_member_count
           RETURNING request_id`,
        )
        .bind(assignmentJson, timestamp, timestamp),
      this.boardDirtyStatement(timestamp, true),
    ]);
    const materialized = results[1]?.results.length ?? 0;
    return { materialized, shouldRetry: materialized < assignments.length };
  }

  async getBoardSnapshot(_now?: Date): Promise<StaffBoardSnapshot> {
    const [stateResult, candidateRows] = await this.database.batch<
      CommunityStateRow | QueueRaidOrderRow
    >([
      this.database.prepare(
        `SELECT staff_board_message_id AS staffBoardMessageId,
                priority_open_raid_count AS priorityRaidCount,
                ordinary_open_raid_count AS ordinaryRaidCount,
                board_dirty_version AS boardDirtyVersion
         FROM community_state WHERE community_id = 'butcoffee'`,
      ),
      this.database.prepare(boundedBoardRaidSql()),
    ]);
    const state = stateResult?.results[0] as CommunityStateRow | undefined;
    const candidates = (candidateRows?.results ?? []) as QueueRaidOrderRow[];
    const fallbackCounts =
      state === undefined
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
      candidates.filter((raid) => raid.isPriority === 1),
    ).slice(0, 3);
    const ordinaryCandidates = orderByModePresence(
      candidates.filter((raid) => raid.isPriority === 0),
    ).slice(0, 7);
    const visibleIds = [...priorityCandidates, ...ordinaryCandidates].map(
      (candidate) => candidate.groupId,
    );
    const detailRows =
      visibleIds.length === 0
        ? { results: [] as RaidRow[] }
        : await this.database
            .prepare(raidSelectSql(`WHERE raid.id IN (${visibleIds.map(() => "?").join(", ")})`, 0))
            .bind(...visibleIds)
            .all<RaidRow>();
    const raidsById = new Map(mapRaidRows(detailRows.results).map((raid) => [raid.id, raid]));
    const hydrate = (candidates: readonly QueueRaidOrderRow[]) =>
      candidates.flatMap((candidate) => {
        const raid = raidsById.get(candidate.groupId);
        return raid === undefined ? [] : [raid];
      });
    return {
      boardVersion: Number(state?.boardDirtyVersion ?? 0),
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
    const state = await this.database
      .prepare(`SELECT state, outcome FROM raid_groups WHERE id = ?`)
      .bind(groupId)
      .first<{ state: number; outcome: number | null }>();
    if (state === null) return undefined;
    let memberState = -1;
    if (state.state === 0 || state.state === 1) memberState = 0;
    else if (state.outcome === 0) memberState = 1;
    const rows = await this.database
      .prepare(raidSelectSql("WHERE raid.id = ?", memberState))
      .bind(groupId)
      .all<RaidRow>();
    return mapRaidRows(rows.results)[0];
  }

  async setCanonicalBoardMessage(input: {
    messageId: string;
    renderedVersion: number;
    changedAt: Date;
  }): Promise<void> {
    const timestamp = epoch(input.changedAt);
    await this.database
      .prepare(
        `INSERT INTO community_state
           (community_id, staff_board_message_id, board_rendered_version, created_at, updated_at)
       VALUES ('butcoffee', ?, ?, ?, ?)
       ON CONFLICT(community_id) DO UPDATE SET
         staff_board_message_id = excluded.staff_board_message_id,
         board_rendered_version = max(community_state.board_rendered_version, ?),
         updated_at = excluded.updated_at`,
      )
      .bind(input.messageId, input.renderedVersion, timestamp, timestamp, input.renderedVersion)
      .run();
  }

  async reviewRaid(input: { groupId: number; changedAt: Date }): Promise<StaffBoardRaid> {
    const timestamp = epoch(input.changedAt);
    const [result] = await this.database.batch([
      this.database
        .prepare(
          `UPDATE raid_groups SET automatic_fill = 0, updated_at = ?
           WHERE id = ? AND state = 0 AND current_member_count > 0`,
        )
        .bind(timestamp, input.groupId),
      this.boardDirtyStatement(timestamp),
    ]);
    if (Number(result?.meta.changes ?? 0) !== 1) {
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

  async getPullRequesterCandidatesForRaids(
    destinationGroupIds: readonly number[],
  ): Promise<ReadonlyMap<number, StaffBoardRaid>> {
    if (destinationGroupIds.length === 0) return new Map();
    const selected = await this.database.batch<{ groupId: number }>(
      destinationGroupIds.map((groupId) =>
        this.database.prepare(pullSourceIdSql(false)).bind(groupId),
      ),
    );
    const pairs = destinationGroupIds.flatMap((destinationGroupId, index) => {
      const sourceGroupId = selected[index]?.results[0]?.groupId;
      return sourceGroupId === undefined ? [] : [{ destinationGroupId, sourceGroupId }];
    });
    const sourceIds = [...new Set(pairs.map((pair) => pair.sourceGroupId))];
    if (sourceIds.length === 0) return new Map();
    const rows = await this.database
      .prepare(raidSelectSql(`WHERE raid.id IN (${sourceIds.map(() => "?").join(", ")})`, 0))
      .bind(...sourceIds)
      .all<RaidRow>();
    const sources = new Map(mapRaidRows(rows.results).map((raid) => [raid.id, raid]));
    return new Map(
      pairs.flatMap((pair) => {
        const source = sources.get(pair.sourceGroupId);
        return source === undefined ? [] : [[pair.destinationGroupId, source] as const];
      }),
    );
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

  private async planPullRequester(input: PullRequesterInput): Promise<PullRequesterPlan> {
    const [destination, candidates] = await Promise.all([
      this.getRaid(input.destinationGroupId),
      this.getPullRequesterCandidates(input.destinationGroupId),
    ]);
    if (
      destination?.state !== "planned" ||
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
    let sourceDisposition: PullRequesterResult["sourceDisposition"] = "retained";
    if (remainder.length === 0) {
      sourceDisposition = "closed";
    } else if (canPush) {
      sourceDisposition = "pushed";
    }
    return {
      destination,
      source,
      remainder,
      remainderJson,
      boundary,
      canPush,
      sourceDisposition,
      crossQueue: destination.queueKind === "priority" && source.queueKind === "ordinary",
      timestamp: epoch(input.changedAt),
    };
  }

  private pullCrossQueueStatements(
    input: PullRequesterInput,
    plan: PullRequesterPlan,
  ): D1PreparedStatement[] {
    if (!plan.crossQueue) return [];
    return [
      this.database
        .prepare(
          `UPDATE help_requests SET is_priority = 1, updated_at = ?
           WHERE id = ? AND state = 1 AND is_priority = 0
             AND EXISTS (
               SELECT 1 FROM raid_group_members
               WHERE group_id = ? AND request_id = ? AND state = 2 AND updated_at = ?
             )`,
        )
        .bind(
          plan.timestamp,
          input.requestId,
          input.sourceGroupId,
          input.requestId,
          plan.timestamp,
        ),
    ];
  }

  private pullPushStatements(
    input: PullRequesterInput,
    plan: PullRequesterPlan,
  ): D1PreparedStatement[] {
    if (!plan.canPush || plan.boundary === null) return [];
    return [
      this.database
        .prepare(
          `UPDATE raid_group_members SET state = 2, updated_at = ?
           WHERE group_id = ? AND state = 0
             AND request_id IN (SELECT value FROM json_each(?))`,
        )
        .bind(plan.timestamp, input.sourceGroupId, plan.remainderJson),
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
               AND NOT EXISTS (
                 SELECT 1 FROM json_each(?) AS expected
                 WHERE NOT EXISTS (
                   SELECT 1 FROM raid_group_members AS removed
                   WHERE removed.group_id = ? AND removed.request_id = expected.value
                     AND removed.state = 2 AND removed.updated_at = ?
                 )
               )
             THEN target.id ELSE NULL END,
             item.value,
             (SELECT coalesce(max(position), 0) FROM raid_group_members
              WHERE group_id = target.id AND state = 0) + CAST(item.key AS INTEGER) + 1,
             ?, ?
           FROM json_each(?) AS item
           JOIN raid_groups AS target ON target.id = ?`,
        )
        .bind(
          plan.source.queueKind === "priority" ? 1 : 0,
          gameModeCode(plan.source.gameMode),
          plan.source.mapId,
          plan.source.sortKey,
          plan.remainderJson,
          plan.remainderJson,
          input.sourceGroupId,
          plan.timestamp,
          plan.timestamp,
          plan.timestamp,
          plan.remainderJson,
          plan.boundary.groupId,
        ),
    ];
  }

  private pullSourceStatement(
    input: PullRequesterInput,
    plan: PullRequesterPlan,
  ): D1PreparedStatement {
    if (plan.sourceDisposition !== "retained") {
      return this.database
        .prepare(
          `UPDATE raid_groups SET state = 3, outcome = 1, staff_message_id = NULL,
                  last_action_key = ?, completed_at = ?, updated_at = ?
           WHERE id = ? AND state = 0 AND automatic_fill = 1
             AND leader_discord_user_id IS NULL AND staff_message_id IS NULL
             AND current_member_count = 0`,
        )
        .bind(input.actionKey, plan.timestamp, plan.timestamp, input.sourceGroupId);
    }
    return this.database
      .prepare(
        `UPDATE raid_groups SET last_action_key = ?, updated_at = ?
         WHERE id = ? AND state = 0 AND automatic_fill = 1
           AND leader_discord_user_id IS NULL AND staff_message_id IS NULL
           AND current_member_count = ?`,
      )
      .bind(input.actionKey, plan.timestamp, input.sourceGroupId, plan.remainder.length);
  }

  private pullDestinationMembershipStatement(
    input: PullRequesterInput,
    plan: PullRequesterPlan,
  ): D1PreparedStatement {
    let sourceStateAssertion = `source.state = 3 AND source.outcome = 1
                                AND source.current_member_count = 0`;
    let sourceStateBindings: unknown[] = [];
    if (plan.sourceDisposition === "retained") {
      sourceStateAssertion = `source.state = 0 AND source.automatic_fill = 1
                              AND source.leader_discord_user_id IS NULL
                              AND source.staff_message_id IS NULL
                              AND source.current_member_count = ?
                              AND (SELECT count(*) FROM raid_group_members AS current
                                   JOIN json_each(?) AS expected
                                     ON expected.value = current.request_id
                                   WHERE current.group_id = source.id AND current.state = 0)
                                  = json_array_length(?)`;
      sourceStateBindings = [plan.remainder.length, plan.remainderJson, plan.remainderJson];
    }

    let pushAssertion = "";
    let pushBindings: unknown[] = [];
    if (plan.sourceDisposition === "pushed" && plan.boundary !== null) {
      pushAssertion = `AND (SELECT count(*) FROM raid_group_members AS pushed
                            JOIN json_each(?) AS expected
                              ON expected.value = pushed.request_id
                            WHERE pushed.group_id = ? AND pushed.state = 0)
                           = json_array_length(?)`;
      pushBindings = [plan.remainderJson, plan.boundary.groupId, plan.remainderJson];
    }

    let retainedBoundaryAssertion = "";
    let retainedBoundaryBindings: unknown[] = [];
    if (plan.sourceDisposition === "retained") {
      if (plan.boundary === null) {
        retainedBoundaryAssertion = `AND NOT EXISTS (
          SELECT 1 FROM raid_groups AS next
          WHERE next.is_priority = source.is_priority
            AND next.game_mode = source.game_mode AND next.map_id = source.map_id
            AND next.state IN (0, 1) AND next.sort_key > source.sort_key
        )`;
      } else {
        retainedBoundaryAssertion = `AND ? = (
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
        retainedBoundaryBindings = [
          plan.boundary.groupId,
          plan.boundary.groupId,
          plan.remainder.length,
        ];
      }
    }

    return this.database
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
        plan.timestamp,
        ...pushBindings,
        ...retainedBoundaryBindings,
        plan.timestamp,
        plan.timestamp,
        input.sourceGroupId,
        input.requestId,
        input.destinationGroupId,
      );
  }

  async pullRequester(input: PullRequesterInput): Promise<PullRequesterResult> {
    const plan = await this.planPullRequester(input);
    const { boundary, sourceDisposition, timestamp } = plan;
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
      ...this.pullCrossQueueStatements(input, plan),
      ...this.pullPushStatements(input, plan),
      this.pullSourceStatement(input, plan),
      this.database
        .prepare(`UPDATE raid_groups SET updated_at = ? WHERE id = ?`)
        .bind(timestamp, input.destinationGroupId),
      this.pullDestinationMembershipStatement(input, plan),
      this.boardDirtyStatement(timestamp),
    ];

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
    const [result] = await this.database.batch([
      this.database
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
        ),
      this.boardDirtyStatement(timestamp),
    ]);
    if (Number(result?.meta.changes ?? 0) !== 1)
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
    return Number(result?.meta.changes ?? 0) === 1;
  }

  async dismissRaidReview(input: {
    groupId: number;
    expectedMessageId: string;
    changedAt: Date;
  }): Promise<boolean> {
    const timestamp = epoch(input.changedAt);
    const [result] = await this.database.batch([
      this.database
        .prepare(
          `UPDATE raid_groups SET staff_message_id = NULL, updated_at = ?
           WHERE id = ? AND state = 0 AND automatic_fill = 0 AND staff_message_id = ?`,
        )
        .bind(timestamp, input.groupId, input.expectedMessageId),
      this.boardDirtyStatement(timestamp),
    ]);
    return Number(result?.meta.changes ?? 0) === 1;
  }

  async recordRaidResult(input: {
    groupId: number;
    outcome: "helped" | "unsuccessful";
    attemptLimit: number;
    actionKey: string;
    changedAt: Date;
  }): Promise<StaffBoardRaid> {
    const raid = await this.getRaid(input.groupId);
    if (raid?.state !== "active")
      throw new RepositoryInvariantError("That raid is no longer active.");
    const timestamp = epoch(input.changedAt);
    if (input.outcome === "unsuccessful") {
      if (raid.attemptCount >= input.attemptLimit)
        throw new RepositoryInvariantError("Choose Helped or Postpone raid for the final attempt.");
      const [result] = await this.database.batch([
        this.database
          .prepare(
            `UPDATE raid_groups SET attempt_count = attempt_count + 1, last_action_key = ?, updated_at = ?
             WHERE id = ? AND state = 1 AND attempt_count < ?`,
          )
          .bind(input.actionKey, timestamp, input.groupId, input.attemptLimit),
        this.boardDirtyStatement(timestamp),
      ]);
      if (Number(result?.meta.changes ?? 0) !== 1)
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
        this.boardDirtyStatement(timestamp),
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
    const window = await this.database
      .prepare(
        `WITH source AS (
           SELECT id, is_priority, game_mode, sort_key, map_id
           FROM raid_groups WHERE id = ? AND state IN (0, 1)
         )
         SELECT source.is_priority AS isPriority, source.sort_key AS sourceSortKey,
                coalesce((
                  SELECT max(target.sort_key)
                  FROM raid_group_follow_ups AS follow_up
                  CROSS JOIN raid_groups AS target
                  WHERE follow_up.source_group_id = source.id
                    AND target.id = follow_up.target_group_id
                    AND target.is_priority = source.is_priority
                    AND target.game_mode = source.game_mode
                    AND target.map_id = source.map_id AND target.state IN (0, 1)
                ), source.sort_key) AS anchorSortKey,
                (SELECT count(*)
                 FROM raid_group_follow_ups AS follow_up
                 CROSS JOIN raid_groups AS target
                 WHERE follow_up.source_group_id = source.id
                   AND target.id = follow_up.target_group_id
                   AND target.is_priority = source.is_priority
                   AND target.game_mode = source.game_mode
                   AND target.map_id = source.map_id AND target.state IN (0, 1)
                ) AS followUpCount,
                (SELECT target.id
                 FROM raid_group_follow_ups AS follow_up
                 CROSS JOIN raid_groups AS target
                 WHERE follow_up.source_group_id = source.id
                   AND target.id = follow_up.target_group_id
                   AND target.is_priority = source.is_priority
                   AND target.game_mode = source.game_mode
                   AND target.map_id = source.map_id AND target.state = 0
                   AND target.automatic_fill = 1
                   AND target.current_member_count < target.requester_capacity
                 ORDER BY target.sort_key LIMIT 1) AS reusableGroupId
         FROM source`,
      )
      .bind(groupId)
      .first<Omit<RequesterFollowUpWindow, "nextSortKey">>();
    if (window === null) return null;
    const next = await this.database
      .prepare(
        `SELECT sort_key AS nextSortKey
         FROM raid_groups INDEXED BY raid_groups_open_sort_key_idx
         WHERE is_priority = ? AND state IN (0, 1) AND sort_key > ?
         ORDER BY sort_key LIMIT 1`,
      )
      .bind(window.isPriority, window.anchorSortKey)
      .first<Pick<RequesterFollowUpWindow, "nextSortKey">>();
    return { ...window, nextSortKey: next?.nextSortKey ?? null };
  }

  private async requirePostponableRequester(input: PostponeRequesterInput): Promise<{
    sourceBecomesEmpty: boolean;
    window: RequesterFollowUpWindow;
  }> {
    const source = await this.getRaid(input.groupId);
    const isReviewedPlanned =
      source?.state === "planned" && !source.automaticFill && source.staffMessageId !== undefined;
    if (source === undefined || (source.state !== "active" && !isReviewedPlanned)) {
      throw new RepositoryInvariantError("That raid is no longer available.");
    }
    if (!source.members.some((member) => member.requestId === input.requestId)) {
      throw new RepositoryInvariantError("That requester is no longer in this raid.");
    }
    const window = await this.requesterFollowUpWindow(input.groupId);
    if (window === null) {
      throw new RepositoryInvariantError("That raid is no longer available.");
    }
    return { sourceBecomesEmpty: source.members.length === 1, window };
  }

  async postponeRequester(
    input: PostponeRequesterInput,
  ): Promise<{ source: StaffBoardRaid; dedicated: StaffBoardRaid }> {
    const { sourceBecomesEmpty, window } = await this.requirePostponableRequester(input);
    const reusableGroupId = window.reusableGroupId;
    const followUpSortKey = requesterFollowUpSortKey(sourceBecomesEmpty, window);
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
    const qualifiedDestinationPredicate =
      reusableGroupId === null ? "destination.last_action_key = ?" : "destination.id = ?";
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
             (SELECT coalesce(max(member.position), 0) + 1
              FROM raid_group_members AS member
              JOIN raid_groups AS destination ON destination.id = member.group_id
              WHERE ${qualifiedDestinationPredicate}
                AND destination.state = 0 AND destination.automatic_fill = 1
                AND destination.current_member_count < destination.requester_capacity
                AND member.state = 0),
             ?, ?
           )`,
        )
        .bind(destinationKey, input.requestId, destinationKey, timestamp, timestamp),
      this.database
        .prepare(
          `INSERT INTO raid_group_follow_ups
             (source_group_id, target_group_id, created_at, updated_at)
           SELECT ?, destination.id, ?, ?
           FROM raid_groups AS destination
           WHERE ${destinationPredicate} AND destination.state = 0
           ON CONFLICT(source_group_id, target_group_id) DO UPDATE SET
             updated_at = excluded.updated_at`,
        )
        .bind(input.groupId, timestamp, timestamp, destinationKey),
      this.boardDirtyStatement(timestamp),
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
      this.boardDirtyStatement(timestamp),
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
    if (source?.state !== "active")
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
      this.boardDirtyStatement(timestamp),
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
    if (input.twitchUserId !== undefined) {
      await this.assertNoStableIdentityCollision(twitchLogin, input.twitchUserId);
    }
    const statements = this.userMappingStatements({
      twitchLogin,
      ...(input.twitchUserId === undefined ? {} : { twitchUserId: input.twitchUserId }),
      ...(input.discordUserId === undefined ? {} : { discordUserId: input.discordUserId }),
      ...(input.discordDisplayName === undefined
        ? {}
        : { discordDisplayName: input.discordDisplayName }),
      ...(input.inGameName === undefined ? {} : { inGameName: input.inGameName }),
      timestamp,
    });
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
        `SELECT submitted_requests AS submittedRequests,
                helped_requests AS helpedRequests,
                open_requests AS openRequests,
                canceled_requests AS canceledRequests,
                successful_raids AS successfulRaids,
                credited_leader_count AS creditedLeaderCount
         FROM staff_statistics_summary WHERE singleton = 1`,
      ),
      this.database.prepare(
        `SELECT discord_user_id AS discordUserId,
                helped_requests AS helpedRequests,
                successful_raids AS successfulRaids
         FROM staff_leader_statistics
         ORDER BY helped_requests DESC, successful_raids DESC, discord_user_id ASC
         LIMIT 10`,
      ),
    ]);
    const summary = results[0]?.results[0] as StatisticsSummaryRow | undefined;
    const leaders = (results[1]?.results ?? []) as unknown as LeaderStatisticRow[];
    const creditedLeaderCount = Number(summary?.creditedLeaderCount ?? 0);
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
    let boundary = "";
    if (input.direction === "at") {
      boundary = "WHERE twitch_login >= ?";
    } else if (input.direction !== "first") {
      boundary = `WHERE twitch_login ${comparator} ?`;
    }
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
    const entries = selected.map((row): StaffUserDirectoryEntry => {
      const entry: StaffUserDirectoryEntry = {
        twitchLogin: row.twitchLogin,
        twitchIdentityObserved: row.twitchUserId !== null,
      };
      if (row.twitchUserId !== null) entry.twitchUserId = row.twitchUserId;
      if (row.discordUserId !== null) entry.discordUserId = row.discordUserId;
      if (row.discordDisplayName !== null) entry.discordDisplayName = row.discordDisplayName;
      if (row.inGameName !== null) entry.inGameName = row.inGameName;
      return entry;
    });
    let hasPrevious: boolean;
    if (input.direction === "first") {
      hasPrevious = false;
    } else if (input.direction === "at") {
      hasPrevious = hasRowsBeforeCursor ?? false;
    } else if (reverse) {
      hasPrevious = lookahead;
    } else {
      hasPrevious = true;
    }
    return {
      entries,
      hasPrevious,
      hasNext: reverse || lookahead,
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
    return row === null ? undefined : directoryEntry(row);
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

  async completeMissingDiscordAndGet(input: {
    twitchLogin: string;
    discordUserId: string;
    discordDisplayName?: string;
    changedAt: Date;
  }): Promise<{ outcome: "updated" | "stale"; entry?: StaffUserDirectoryEntry }> {
    const normalized = normalizeTwitchLogin(input.twitchLogin);
    if (normalized === undefined) return { outcome: "stale" };
    const row = await this.database
      .prepare(
        `UPDATE user_mappings
         SET discord_user_id = ?, discord_display_name = ?, updated_at = ?
         WHERE twitch_login = ? AND discord_user_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM user_mappings AS conflict
             WHERE conflict.discord_user_id = ? AND conflict.twitch_login <> ?
           )
         RETURNING twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
                   discord_user_id AS discordUserId,
                   discord_display_name AS discordDisplayName,
                   in_game_name AS inGameName`,
      )
      .bind(
        input.discordUserId,
        input.discordDisplayName ?? null,
        epoch(input.changedAt),
        normalized,
        input.discordUserId,
        normalized,
      )
      .first<UserMappingRow>();
    if (row !== null) return { outcome: "updated", entry: directoryEntry(row) };
    const entry = await this.findUserMappingByTwitchLogin(normalized);
    return { outcome: "stale", ...(entry === undefined ? {} : { entry }) };
  }

  async completeMissingInGameNameAndGet(input: {
    twitchLogin: string;
    inGameName: string;
    changedAt: Date;
  }): Promise<{ outcome: "updated" | "stale"; entry?: StaffUserDirectoryEntry }> {
    const normalized = normalizeTwitchLogin(input.twitchLogin);
    const inGameName = input.inGameName.trim();
    if (normalized === undefined || inGameName.length < 1 || inGameName.length > 64) {
      return { outcome: "stale" };
    }
    const row = await this.database
      .prepare(
        `UPDATE user_mappings SET in_game_name = ?, updated_at = ?
         WHERE twitch_login = ? AND in_game_name IS NULL
         RETURNING twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
                   discord_user_id AS discordUserId,
                   discord_display_name AS discordDisplayName,
                   in_game_name AS inGameName`,
      )
      .bind(inGameName, epoch(input.changedAt), normalized)
      .first<UserMappingRow>();
    if (row !== null) return { outcome: "updated", entry: directoryEntry(row) };
    const entry = await this.findUserMappingByTwitchLogin(normalized);
    return { outcome: "stale", ...(entry === undefined ? {} : { entry }) };
  }

  async observeTwitchIdentity(input: {
    twitchLogin: string;
    twitchUserId: string;
    observedAt: Date;
  }): Promise<void> {
    const twitchLogin = normalizeTwitchLogin(input.twitchLogin);
    if (twitchLogin === undefined) throw new RepositoryInvariantError("Enter a valid Twitch name.");
    const timestamp = epoch(input.observedAt);
    const [stableResult, targetResult] = await this.database.batch<UserMappingRow>([
      this.database
        .prepare(
          `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
                  discord_user_id AS discordUserId,
                  discord_display_name AS discordDisplayName, in_game_name AS inGameName,
                  twitch_observed_at AS twitchObservedAt
           FROM user_mappings WHERE twitch_user_id = ?`,
        )
        .bind(input.twitchUserId),
      this.database
        .prepare(
          `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
                  discord_user_id AS discordUserId,
                  discord_display_name AS discordDisplayName, in_game_name AS inGameName,
                  twitch_observed_at AS twitchObservedAt
           FROM user_mappings WHERE twitch_login = ?`,
        )
        .bind(twitchLogin),
    ]);
    const stable = stableResult?.results[0];
    const target = targetResult?.results[0];
    if (stable !== undefined && Number(stable.twitchObservedAt ?? 0) > timestamp) return;
    if (
      target?.twitchUserId !== null &&
      target?.twitchUserId !== undefined &&
      target.twitchUserId !== input.twitchUserId
    ) {
      throw new StableTwitchIdentityConflictError(
        "That Twitch login belongs to another verified Twitch identity. Staff must resolve it.",
      );
    }
    if (
      stable?.twitchLogin === twitchLogin &&
      stable.twitchUserId === input.twitchUserId &&
      target?.twitchUserId === input.twitchUserId
    ) {
      if (Number(stable.twitchObservedAt ?? 0) < timestamp) {
        await this.database
          .prepare(
            `UPDATE user_mappings
             SET twitch_observed_at = ?, updated_at = max(updated_at, ?)
             WHERE twitch_user_id = ? AND twitch_login = ? AND twitch_observed_at < ?`,
          )
          .bind(timestamp, timestamp, input.twitchUserId, twitchLogin, timestamp)
          .run();
      }
      return;
    }
    if (stable !== undefined && stable.twitchLogin !== twitchLogin && target === undefined) {
      await this.database
        .prepare(
          `UPDATE user_mappings
           SET twitch_login = ?, twitch_observed_at = ?, updated_at = max(updated_at, ?)
           WHERE twitch_user_id = ? AND twitch_login = ? AND twitch_observed_at <= ?`,
        )
        .bind(twitchLogin, timestamp, timestamp, input.twitchUserId, stable.twitchLogin, timestamp)
        .run();
      return;
    }
    if (stable !== undefined && stable.twitchLogin !== twitchLogin && target !== undefined) {
      const discordUserId = target.discordUserId ?? stable.discordUserId;
      const discordDisplayName = target.discordDisplayName ?? stable.discordDisplayName;
      const inGameName = target.inGameName ?? stable.inGameName;
      await this.database.batch([
        this.database
          .prepare(
            `UPDATE user_mappings
             SET twitch_user_id = NULL, discord_user_id = NULL,
                 discord_display_name = NULL, in_game_name = NULL, updated_at = ?
             WHERE twitch_login = ? AND twitch_user_id = ? AND twitch_observed_at <= ?`,
          )
          .bind(timestamp, stable.twitchLogin, input.twitchUserId, timestamp),
        this.database
          .prepare(
            `UPDATE user_mappings
             SET twitch_user_id = ?, discord_user_id = ?, discord_display_name = ?,
                 in_game_name = ?, twitch_observed_at = ?, updated_at = max(updated_at, ?)
             WHERE twitch_login = ? AND twitch_observed_at <= ?`,
          )
          .bind(
            input.twitchUserId,
            discordUserId,
            discordDisplayName,
            inGameName,
            timestamp,
            timestamp,
            twitchLogin,
            timestamp,
          ),
        this.database
          .prepare(
            `UPDATE help_requests AS request
             SET twitch_login = ?, updated_at = ?
             WHERE request.twitch_user_id = ? AND request.twitch_login <> ?
               AND NOT EXISTS (
                 SELECT 1 FROM help_requests AS conflict
                 WHERE conflict.id <> request.id
                   AND conflict.twitch_login = ?
                   AND conflict.game_mode = request.game_mode
                   AND conflict.map_id = request.map_id
                   AND conflict.state IN (0, 1)
               )`,
          )
          .bind(twitchLogin, timestamp, input.twitchUserId, twitchLogin, twitchLogin),
        this.database
          .prepare(
            `DELETE FROM user_mappings
             WHERE twitch_login = ? AND twitch_user_id IS NULL
               AND discord_user_id IS NULL AND in_game_name IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM help_requests
                 WHERE help_requests.twitch_login = user_mappings.twitch_login
               )`,
          )
          .bind(stable.twitchLogin),
      ]);
      return;
    }
    await this.database.batch(
      this.userMappingStatements({
        twitchLogin,
        twitchUserId: input.twitchUserId,
        timestamp,
        twitchObservationTimestamp: timestamp,
      }),
    );
  }

  async markBoardDirty(changedAt: Date): Promise<number> {
    const row = await this.database
      .prepare(
        `INSERT INTO community_state
           (community_id, board_dirty_version, created_at, updated_at)
         VALUES ('butcoffee', 1, ?, ?)
         ON CONFLICT(community_id) DO UPDATE SET
           board_dirty_version = community_state.board_dirty_version + 1,
           updated_at = excluded.updated_at
         RETURNING board_dirty_version AS dirtyVersion`,
      )
      .bind(epoch(changedAt), epoch(changedAt))
      .first<{ dirtyVersion: number }>();
    if (row === null) throw new RepositoryInvariantError("the board state is unavailable");
    return Number(row.dirtyVersion);
  }

  async acquireBoardDrainLease(input: {
    token: string;
    changedAt: Date;
    createIfMissing: boolean;
  }): Promise<BoardDrainLease | undefined> {
    const timestamp = epoch(input.changedAt);
    const projection = `RETURNING board_dirty_version AS dirtyVersion,
                                  board_rendered_version AS renderedVersion,
                                  board_lease_token AS token,
                                  staff_board_message_id AS canonicalMessageId`;
    const statement = input.createIfMissing
      ? this.database
          .prepare(
            `INSERT INTO community_state
               (community_id, board_lease_token, board_lease_until, created_at, updated_at)
             VALUES ('butcoffee', ?, ?, ?, ?)
             ON CONFLICT(community_id) DO UPDATE SET
               board_lease_token = excluded.board_lease_token,
               board_lease_until = excluded.board_lease_until,
               updated_at = excluded.updated_at
             WHERE (community_state.board_dirty_version > community_state.board_rendered_version
                    OR community_state.staff_board_message_id IS NULL)
               AND (community_state.board_lease_until <= ?
                    OR community_state.board_lease_token = ?)
             ${projection}`,
          )
          .bind(
            input.token,
            timestamp + BOARD_DRAIN_LEASE_MS,
            timestamp,
            timestamp,
            timestamp,
            input.token,
          )
      : this.database
          .prepare(
            `UPDATE community_state
             SET board_lease_token = ?, board_lease_until = ?, updated_at = ?
             WHERE community_id = 'butcoffee'
               AND board_dirty_version > board_rendered_version
               AND staff_board_message_id IS NOT NULL
               AND (board_lease_until <= ? OR board_lease_token = ?)
             ${projection}`,
          )
          .bind(input.token, timestamp + BOARD_DRAIN_LEASE_MS, timestamp, timestamp, input.token);
    const row = await statement.first<{
      dirtyVersion: number;
      renderedVersion: number;
      token: string;
      canonicalMessageId: string | null;
    }>();
    return row === null
      ? undefined
      : {
          dirtyVersion: Number(row.dirtyVersion),
          renderedVersion: Number(row.renderedVersion),
          token: row.token,
          ...(row.canonicalMessageId === null
            ? {}
            : { canonicalMessageId: row.canonicalMessageId }),
        };
  }

  async completeBoardDrain(input: {
    token: string;
    renderedVersion: number;
    expectedMessageId: string | null;
    messageId?: string;
    changedAt: Date;
  }): Promise<{
    applied: boolean;
    current: boolean;
    hasMore: boolean;
    canonicalMessageId?: string;
  }> {
    const row = await this.database
      .prepare(
        `UPDATE community_state
         SET board_rendered_version = max(board_rendered_version, ?),
             staff_board_message_id = coalesce(?, staff_board_message_id),
             board_lease_until = 0, board_lease_token = NULL, updated_at = ?
         WHERE community_id = 'butcoffee' AND board_lease_token = ?
           AND ((? IS NULL AND staff_board_message_id IS NULL)
                OR staff_board_message_id = ?)
         RETURNING board_dirty_version = ? AS current,
                   board_dirty_version > board_rendered_version AS hasMore,
                   staff_board_message_id AS canonicalMessageId`,
      )
      .bind(
        input.renderedVersion,
        input.messageId ?? null,
        epoch(input.changedAt),
        input.token,
        input.expectedMessageId,
        input.expectedMessageId,
        input.renderedVersion,
      )
      .first<{ current: number; hasMore: number; canonicalMessageId: string | null }>();
    return {
      applied: row !== null,
      current: Number(row?.current ?? 0) === 1,
      hasMore: Number(row?.hasMore ?? 0) === 1,
      ...(row?.canonicalMessageId == null ? {} : { canonicalMessageId: row.canonicalMessageId }),
    };
  }

  async getCanonicalBoardMessageId(): Promise<string | undefined> {
    const row = await this.database
      .prepare(
        `SELECT staff_board_message_id AS canonicalMessageId
         FROM community_state WHERE community_id = 'butcoffee'`,
      )
      .first<{ canonicalMessageId: string | null }>();
    return row?.canonicalMessageId ?? undefined;
  }

  async releaseBoardDrainLease(token: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE community_state SET board_lease_until = 0, board_lease_token = NULL
         WHERE community_id = 'butcoffee' AND board_lease_token = ?`,
      )
      .bind(token)
      .run();
  }

  linkDiscordToTwitch(input: {
    twitchLogin: string;
    discordUserId: string;
    discordDisplayName?: string;
    inGameName?: string;
    linkedAt: Date;
  }): Promise<void> {
    const twitchLogin = normalizeTwitchLogin(input.twitchLogin);
    if (twitchLogin === undefined) throw new RepositoryInvariantError("Enter a valid Twitch name.");
    return this.database
      .batch(
        this.userMappingStatements({
          twitchLogin,
          discordUserId: input.discordUserId,
          ...(input.discordDisplayName === undefined
            ? {}
            : { discordDisplayName: input.discordDisplayName }),
          ...(input.inGameName === undefined ? {} : { inGameName: input.inGameName }),
          timestamp: epoch(input.linkedAt),
        }),
      )
      .then(() => undefined);
  }

  async claimTwitchCommand(input: {
    deliveryId: string;
    eventType: string;
    receivedAt: Date;
    claimedAt: Date;
  }): Promise<TwitchCommandClaim> {
    const existing = await this.findTwitchCommand(input.deliveryId);
    const claimTimestamp = epoch(input.claimedAt);
    if (existing?.outcome === "ready") return existing;
    if (
      existing?.outcome === "processing" &&
      existing.processingUntil !== null &&
      existing.processingUntil > claimTimestamp
    ) {
      return { outcome: "processing" };
    }
    const claimToken = crypto.randomUUID();
    if (existing?.outcome === "processing") {
      const reclaimed = await this.database
        .prepare(
          `UPDATE event_receipts
           SET twitch_processing_token = ?, twitch_processing_until = ?
           WHERE platform = 1 AND delivery_id = ? AND reply_status IS NULL
             AND twitch_processing_until <= ?
           RETURNING twitch_processing_token AS claimToken`,
        )
        .bind(
          claimToken,
          claimTimestamp + TWITCH_COMMAND_CLAIM_MS,
          input.deliveryId,
          claimTimestamp,
        )
        .first<{ claimToken: string }>();
      return reclaimed === null
        ? { outcome: "processing" }
        : { outcome: "claimed", claimToken: reclaimed.claimToken };
    }
    const inserted = await this.database
      .prepare(
        `INSERT INTO event_receipts
         (platform, delivery_id, event_type, received_at,
          twitch_processing_until, twitch_processing_token)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(platform, delivery_id) DO NOTHING
         RETURNING twitch_processing_token AS claimToken`,
      )
      .bind(
        input.deliveryId,
        input.eventType,
        epoch(input.receivedAt),
        claimTimestamp + TWITCH_COMMAND_CLAIM_MS,
        claimToken,
      )
      .first<{ claimToken: string }>();
    if (inserted !== null) return { outcome: "claimed", claimToken: inserted.claimToken };
    return (await this.findTwitchCommand(input.deliveryId)) ?? { outcome: "processing" };
  }

  async findTwitchCommand(
    deliveryId: string,
  ): Promise<
    | { outcome: "processing"; processingUntil: number | null }
    | { outcome: "ready"; receipt: TwitchReplyReceipt }
    | undefined
  > {
    const row = await this.database
      .prepare(
        `SELECT twitch_reply_text AS replyText, twitch_reply_to_message_id AS replyToMessageId,
              CASE reply_status WHEN 0 THEN 'pending' WHEN 1 THEN 'sent'
                                WHEN 2 THEN 'failed' END AS replyStatus,
              twitch_processing_until AS processingUntil,
              twitch_processing_token AS processingToken,
              twitch_send_token AS sendToken
       FROM event_receipts WHERE platform = 1 AND delivery_id = ?`,
      )
      .bind(deliveryId)
      .first<TwitchReceiptRow>();
    if (row === null) return undefined;
    if (row.replyText === null || row.replyStatus === null) {
      return { outcome: "processing", processingUntil: row.processingUntil };
    }
    return { outcome: "ready", receipt: twitchReplyReceipt(row) };
  }

  async completeTwitchCommand(input: {
    deliveryId: string;
    claimToken: string;
    replyText: string;
    replyToMessageId?: string;
  }): Promise<TwitchReplyReceipt> {
    const row = await this.database
      .prepare(
        `UPDATE event_receipts
         SET twitch_reply_text = ?, twitch_reply_to_message_id = ?, reply_status = 0,
             twitch_processing_until = NULL, twitch_processing_token = NULL
         WHERE platform = 1 AND delivery_id = ? AND reply_status IS NULL
           AND twitch_processing_token = ?
         RETURNING twitch_reply_text AS replyText,
                   twitch_reply_to_message_id AS replyToMessageId,
                   'pending' AS replyStatus,
                   twitch_processing_until AS processingUntil,
                   twitch_processing_token AS processingToken,
                   twitch_send_token AS sendToken`,
      )
      .bind(input.replyText, input.replyToMessageId ?? null, input.deliveryId, input.claimToken)
      .first<TwitchReceiptRow>();
    if (row === null) {
      throw new RepositoryInvariantError("The Twitch command processing claim expired.");
    }
    return twitchReplyReceipt(row);
  }

  async releaseTwitchCommand(deliveryId: string, claimToken: string): Promise<void> {
    await this.database
      .prepare(
        `DELETE FROM event_receipts
         WHERE platform = 1 AND delivery_id = ? AND reply_status IS NULL
           AND twitch_processing_token = ?`,
      )
      .bind(deliveryId, claimToken)
      .run();
  }

  async claimTwitchReplyDelivery(
    deliveryId: string,
  ): Promise<TwitchReplyDeliveryClaim | undefined> {
    const sendToken = crypto.randomUUID();
    const row = await this.database
      .prepare(
        `UPDATE event_receipts SET twitch_send_token = ?
         WHERE platform = 1 AND delivery_id = ? AND reply_status IN (0, 2)
           AND twitch_send_token IS NULL AND twitch_reply_text IS NOT NULL
         RETURNING twitch_reply_text AS replyText,
                   twitch_reply_to_message_id AS replyToMessageId,
                   CASE reply_status WHEN 0 THEN 'pending' ELSE 'failed' END AS replyStatus,
                   twitch_processing_until AS processingUntil,
                   twitch_processing_token AS processingToken,
                   twitch_send_token AS sendToken`,
      )
      .bind(sendToken, deliveryId)
      .first<TwitchReceiptRow>();
    return row === null ? undefined : { sendToken, receipt: twitchReplyReceipt(row) };
  }

  async markTwitchReplySent(
    deliveryId: string,
    sendToken: string,
    platformMessageId: string,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE event_receipts SET reply_status = 1, reply_attempts = reply_attempts + 1,
         platform_message_id = ?, last_error_code = NULL, twitch_send_token = NULL
         WHERE platform = 1 AND delivery_id = ? AND twitch_send_token = ?`,
      )
      .bind(platformMessageId, deliveryId, sendToken)
      .run();
  }

  async markTwitchReplyFailed(
    deliveryId: string,
    sendToken: string,
    errorCode: string,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE event_receipts SET reply_status = 2, reply_attempts = reply_attempts + 1,
         last_error_code = ?, twitch_send_token = NULL
         WHERE platform = 1 AND delivery_id = ? AND twitch_send_token = ?`,
      )
      .bind(errorCode, deliveryId, sendToken)
      .run();
  }

  async markTwitchReplyAmbiguous(
    deliveryId: string,
    sendToken: string,
    errorCode: string,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE event_receipts SET reply_attempts = reply_attempts + 1,
         last_error_code = ?
         WHERE platform = 1 AND delivery_id = ? AND twitch_send_token = ?`,
      )
      .bind(errorCode, deliveryId, sendToken)
      .run();
  }

  async claimDiscordMutation(
    deliveryId: string,
    eventType: string,
    receivedAt: Date,
    claimedAt: Date,
  ): Promise<string | undefined> {
    const receivedTimestamp = epoch(receivedAt);
    const claimTimestamp = epoch(claimedAt);
    const claimToken = crypto.randomUUID();
    const row = await this.database
      .prepare(
        `INSERT INTO event_receipts
           (platform, delivery_id, event_type, received_at,
            discord_mutation_status, discord_claim_until, discord_claim_token)
         VALUES (0, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(platform, delivery_id) DO UPDATE SET
           event_type = excluded.event_type,
           discord_mutation_status = 0,
           discord_claim_until = excluded.discord_claim_until,
           discord_claim_token = excluded.discord_claim_token
         WHERE event_receipts.discord_mutation_status = 0
           AND event_receipts.discord_claim_until <= ?
         RETURNING discord_claim_token AS claimToken`,
      )
      .bind(
        deliveryId,
        eventType,
        receivedTimestamp,
        claimTimestamp + DISCORD_MUTATION_CLAIM_MS,
        claimToken,
        claimTimestamp,
      )
      .first<{ claimToken: string }>();
    return row?.claimToken;
  }

  async completeDiscordMutation(deliveryId: string, claimToken: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE event_receipts
         SET discord_mutation_status = 1, discord_claim_until = NULL,
             discord_claim_token = NULL
         WHERE platform = 0 AND delivery_id = ? AND discord_mutation_status = 0
           AND discord_claim_token = ?`,
      )
      .bind(deliveryId, claimToken)
      .run();
  }

  async releaseDiscordMutation(deliveryId: string, claimToken: string): Promise<void> {
    await this.database
      .prepare(
        `DELETE FROM event_receipts
         WHERE platform = 0 AND delivery_id = ? AND discord_mutation_status = 0
           AND discord_claim_token = ?`,
      )
      .bind(deliveryId, claimToken)
      .run();
  }

  async maintainExpiredReceipts(now: Date): Promise<{ ran: boolean; deleted: number }> {
    const timestamp = epoch(now);
    const lease = await this.database
      .prepare(
        `UPDATE community_state
         SET receipt_cleanup_after = ?, updated_at = ?
         WHERE community_id = 'butcoffee' AND receipt_cleanup_after <= ?
         RETURNING receipt_cleanup_after`,
      )
      .bind(timestamp + RECEIPT_CLEANUP_INTERVAL_MS, timestamp, timestamp)
      .first<{ receiptCleanupAfter: number }>();
    if (lease === null) return { ran: false, deleted: 0 };
    const result = await this.database
      .prepare(
        `DELETE FROM event_receipts WHERE (platform, delivery_id) IN (
           SELECT platform, delivery_id FROM event_receipts WHERE received_at < ?
           ORDER BY received_at, platform, delivery_id LIMIT ?
         )`,
      )
      .bind(timestamp - RECEIPT_TTL_MS, RECEIPT_CLEANUP_BATCH_SIZE)
      .run();
    return { ran: true, deleted: Number(result.meta.changes ?? 0) };
  }

  async getDiagnostics(): Promise<{
    hasLegacyUnassignedRequests: boolean;
    tableCount: number;
    requestCount: number;
    stableIdentityRepairCount: number;
  }> {
    const results = await this.database.batch([
      this.database.prepare(
        `SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
      ),
      this.database.prepare(
        `SELECT statistics.submitted_requests AS count,
                state.stable_identity_repair_count AS stableIdentityRepairCount
         FROM staff_statistics_summary AS statistics
         JOIN community_state AS state ON state.community_id = 'butcoffee'
         WHERE statistics.singleton = 1`,
      ),
      this.database.prepare(`SELECT EXISTS(SELECT 1 FROM help_requests WHERE state = 0) AS count`),
    ]);
    const count = (index: number) =>
      Number((results[index]?.results[0] as { count?: number } | undefined)?.count ?? 0);
    return {
      tableCount: count(0),
      requestCount: count(1),
      stableIdentityRepairCount: Number(
        (results[1]?.results[0] as { stableIdentityRepairCount?: number } | undefined)
          ?.stableIdentityRepairCount ?? 0,
      ),
      hasLegacyUnassignedRequests: count(2) === 1,
    };
  }
}

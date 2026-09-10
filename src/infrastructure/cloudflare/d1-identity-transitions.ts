import {
  DiscordIdentityConflictError,
  RepositoryInvariantError,
  StableTwitchIdentityConflictError,
} from "../../domain/sherpa-repository";
import { normalizeTwitchLogin } from "../../domain/user-identity";

export interface UserMappingRow {
  twitchLogin: string;
  twitchUserId: string | null;
  discordUserId: string | null;
  discordDisplayName: string | null;
  inGameName: string | null;
  twitchObservedAt?: number;
}

interface MappingInput {
  twitchLogin: string;
  twitchUserId?: string;
  discordUserId?: string;
  discordDisplayName?: string;
  inGameName?: string;
  timestamp: number;
  twitchObservationTimestamp?: number;
}

interface IdentityObservation {
  twitchLogin: string;
  twitchUserId: string;
  timestamp: number;
}

const mappingProjection = `twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
  discord_user_id AS discordUserId, discord_display_name AS discordDisplayName,
  in_game_name AS inGameName, twitch_observed_at AS twitchObservedAt`;

function isOlderObservation(stable: UserMappingRow | undefined, timestamp: number): boolean {
  return stable !== undefined && Number(stable.twitchObservedAt ?? 0) > timestamp;
}

function resolveObservation(
  input: IdentityObservation,
  stable: UserMappingRow | undefined,
  target: UserMappingRow | undefined,
) {
  if (isOlderObservation(stable, input.timestamp)) {
    return { twitchLogin: (stable as UserMappingRow).twitchLogin, kind: "stale" as const };
  }
  if (target?.twitchUserId != null && target.twitchUserId !== input.twitchUserId) {
    throw new StableTwitchIdentityConflictError(
      "That Twitch login belongs to another verified Twitch identity. Staff must resolve it.",
    );
  }
  return {
    twitchLogin: input.twitchLogin,
    kind:
      stable !== undefined && stable.twitchLogin !== input.twitchLogin && target !== undefined
        ? ("merge" as const)
        : ("current" as const),
  };
}

export class D1IdentityTransitions {
  constructor(private readonly database: D1Database) {}

  discordAttachmentGuard(twitchLogin: string, discordUserId: string): D1PreparedStatement {
    // An invalid JSON path aborts the batch without writing a guard row.
    return this.database
      .prepare(
        `SELECT json_extract('{}', CASE WHEN EXISTS (
         SELECT 1 FROM user_mappings WHERE twitch_login = ?
           AND discord_user_id IS NOT NULL AND discord_user_id <> ?
       ) THEN 'discord_link_conflict' ELSE '$' END)`,
      )
      .bind(twitchLogin, discordUserId);
  }

  async assertNoStableIdentityCollision(twitchLogin: string, twitchUserId: string): Promise<void> {
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

  mappingStatements(input: {
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

  private mergeStatements(
    input: IdentityObservation,
    stable: UserMappingRow,
    target: UserMappingRow,
  ): D1PreparedStatement[] {
    const { twitchLogin, timestamp } = input;
    const discordUserId = target.discordUserId ?? stable.discordUserId;
    const discordDisplayName = target.discordDisplayName ?? stable.discordDisplayName;
    const inGameName = target.inGameName ?? stable.inGameName;
    return [
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
    ];
  }

  async prepareRequestMapping(
    input: MappingInput,
  ): Promise<{ twitchLogin: string; statements: D1PreparedStatement[] }> {
    if (input.twitchUserId === undefined) {
      return { twitchLogin: input.twitchLogin, statements: this.mappingStatements(input) };
    }
    const stable =
      (await this.database
        .prepare(`SELECT ${mappingProjection} FROM user_mappings WHERE twitch_user_id = ?`)
        .bind(input.twitchUserId)
        .first<UserMappingRow>()) ?? undefined;
    const observation = {
      twitchLogin: input.twitchLogin,
      twitchUserId: input.twitchUserId,
      timestamp: input.twitchObservationTimestamp ?? 0,
    };
    const target = isOlderObservation(stable, observation.timestamp)
      ? undefined
      : ((await this.database
          .prepare(`SELECT ${mappingProjection} FROM user_mappings WHERE twitch_login = ?`)
          .bind(input.twitchLogin)
          .first<UserMappingRow>()) ?? undefined);
    const resolution = resolveObservation(observation, stable, target);
    const mapping = { ...input, twitchLogin: resolution.twitchLogin };
    if (resolution.kind === "merge") {
      // These statements join the request/assignment batch; never commit the merge first.
      return {
        twitchLogin: resolution.twitchLogin,
        statements: [
          ...this.mergeStatements(observation, stable as UserMappingRow, target as UserMappingRow),
          ...this.mappingStatements(mapping),
        ],
      };
    }
    return { twitchLogin: resolution.twitchLogin, statements: this.mappingStatements(mapping) };
  }

  async observe(input: {
    twitchLogin: string;
    twitchUserId: string;
    observedAt: Date;
  }): Promise<void> {
    const twitchLogin = normalizeTwitchLogin(input.twitchLogin);
    if (twitchLogin === undefined) throw new RepositoryInvariantError("Enter a valid Twitch name.");
    const timestamp = input.observedAt.getTime();
    const [stableResult, targetResult] = await this.database.batch<UserMappingRow>([
      this.database
        .prepare(`SELECT ${mappingProjection} FROM user_mappings WHERE twitch_user_id = ?`)
        .bind(input.twitchUserId),
      this.database
        .prepare(`SELECT ${mappingProjection} FROM user_mappings WHERE twitch_login = ?`)
        .bind(twitchLogin),
    ]);
    const stable = stableResult?.results[0];
    const target = targetResult?.results[0];
    const observation = { twitchLogin, twitchUserId: input.twitchUserId, timestamp };
    const resolution = resolveObservation(observation, stable, target);
    if (resolution.kind === "stale") return;
    if (resolution.kind === "merge") {
      await this.database.batch(
        this.mergeStatements(observation, stable as UserMappingRow, target as UserMappingRow),
      );
      return;
    }
    if (
      stable?.twitchLogin === twitchLogin &&
      stable.twitchUserId === input.twitchUserId &&
      target?.twitchUserId === input.twitchUserId
    ) {
      if (Number(stable.twitchObservedAt ?? 0) < timestamp) {
        await this.database
          .prepare(`UPDATE user_mappings
          SET twitch_observed_at = ?, updated_at = max(updated_at, ?)
          WHERE twitch_user_id = ? AND twitch_login = ? AND twitch_observed_at < ?`)
          .bind(timestamp, timestamp, input.twitchUserId, twitchLogin, timestamp)
          .run();
      }
      return;
    }
    if (stable !== undefined && stable.twitchLogin !== twitchLogin && target === undefined) {
      await this.database
        .prepare(`UPDATE user_mappings
        SET twitch_login = ?, twitch_observed_at = ?, updated_at = max(updated_at, ?)
        WHERE twitch_user_id = ? AND twitch_login = ? AND twitch_observed_at <= ?`)
        .bind(twitchLogin, timestamp, timestamp, input.twitchUserId, stable.twitchLogin, timestamp)
        .run();
      return;
    }
    await this.database.batch(
      this.mappingStatements({
        twitchLogin,
        twitchUserId: input.twitchUserId,
        timestamp,
        twitchObservationTimestamp: timestamp,
      }),
    );
  }
}

export function rethrowDiscordAttachmentConflict(error: unknown): never {
  if (error instanceof Error && error.message.includes("discord_link_conflict")) {
    throw new DiscordIdentityConflictError(
      "That Twitch name is linked to another Discord member. Ask staff to change the link.",
    );
  }
  throw error;
}

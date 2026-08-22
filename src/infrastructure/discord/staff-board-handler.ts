import type { CommunityConfig } from "../../config/community";
import { resolveTarkovMap } from "../../domain/maps/catalog";
import { appendRaidBringSuffix } from "../../domain/raid-call";
import { formatModeMap } from "../../domain/game-mode";
import { RepositoryInvariantError } from "../../domain/sherpa-repository";
import { isStaffBoardMember, type StaffBoardRaid } from "../../domain/staff-board";
import { type BoardDrainLease, D1MvpRepository } from "../cloudflare/d1-mvp-repository";
import type { CloudflareEnvironment } from "../cloudflare/environment";
import type { TrackedExecutionContext } from "../cloudflare/telemetry";
import { logDiagnostic } from "../cloudflare/diagnostics";
import { sendTwitchChatMessage } from "../twitch/twitch-api";
import {
  DISCORD_EPHEMERAL_MESSAGE_FLAG,
  DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
  DISCORD_INTERACTION_RESPONSE_DEFERRED_CHANNEL_MESSAGE,
  DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE,
  type DiscordApplicationCommandInteraction,
  type DiscordMessageComponentInteraction,
} from "./interactions";
import {
  createDiscordMessage,
  deleteDiscordMessage,
  DiscordApiError,
  discordMessageUrl,
  updateDiscordInteractionResponse,
  updateDiscordMessage,
} from "./messages";
import {
  parseRaidMessageAction,
  parseStaffBoardAction,
  renderPullRequesterSelector,
  renderRaidMessage,
  renderStaffBoard,
  type DiscordBotMessage,
  type RaidMessageAction,
} from "./staff-board";

type StaffInteraction = Pick<
  DiscordApplicationCommandInteraction,
  "discordUserId" | "discordRoleIds" | "channelId" | "applicationId" | "interactionToken"
>;

export interface StaffBoardHandlerDependencies {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  context?: ExecutionContext | TrackedExecutionContext;
}

export function scheduleBackground(
  context: ExecutionContext | TrackedExecutionContext | undefined,
  name: string,
  environment: CloudflareEnvironment,
  task: (measured: CloudflareEnvironment) => Promise<unknown>,
): void {
  if (context === undefined) return;
  const tracked = context as Partial<TrackedExecutionContext>;
  if (typeof tracked.waitUntilTask === "function") {
    tracked.waitUntilTask(name, task);
  } else {
    context.waitUntil(task(environment));
  }
}

function ephemeral(content: string): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data: { content, flags: DISCORD_EPHEMERAL_MESSAGE_FLAG, allowed_mentions: { parse: [] } },
  });
}

function ephemeralMessage(message: DiscordBotMessage): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data: { ...message, flags: DISCORD_EPHEMERAL_MESSAGE_FLAG },
  });
}

function deferredEphemeral(): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_DEFERRED_CHANNEL_MESSAGE,
    data: { flags: DISCORD_EPHEMERAL_MESSAGE_FLAG },
  });
}

function update(message: DiscordBotMessage): Response {
  return Response.json({ type: DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE, data: message });
}

function hasAccess(interaction: StaffInteraction, config: CommunityConfig): boolean {
  return (
    interaction.channelId === config.discord.staffChannelId &&
    isStaffBoardMember({
      discordUserId: interaction.discordUserId,
      discordRoleIds: interaction.discordRoleIds,
      streamerDiscordUserId: config.discord.streamerUserId,
      volunteerRoleId: config.discord.volunteerRoleId,
    })
  );
}

function selectedValue(interaction: DiscordMessageComponentInteraction): string {
  const value = interaction.values[0];
  if (value === undefined) throw new RepositoryInvariantError("Choose an available action.");
  return value;
}

function boardMessage(
  snapshot: Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>>,
  config: CommunityConfig,
): DiscordBotMessage {
  return renderStaffBoard(snapshot, {
    attemptLimit: config.policies.attemptLimit,
    guildId: config.discord.guildId,
    staffChannelId: config.discord.staffChannelId,
  });
}

async function raidDetailMessage(input: {
  raid: StaffBoardRaid;
  repository: D1MvpRepository;
  communityConfig: CommunityConfig;
  notificationUserId?: string;
  pullCandidateSource?: StaffBoardRaid;
  candidatesPreloaded?: boolean;
}): Promise<DiscordBotMessage> {
  const canPull =
    input.raid.state === "planned" &&
    !input.raid.automaticFill &&
    input.raid.members.length < input.raid.requesterCapacity;
  let candidates: { source: StaffBoardRaid } | undefined;
  if (input.candidatesPreloaded) {
    if (input.pullCandidateSource !== undefined) {
      candidates = { source: input.pullCandidateSource };
    }
  } else if (canPull) {
    candidates = await input.repository.getPullRequesterCandidates(input.raid.id, {
      requireStaffMessage: false,
    });
  }
  return renderRaidMessage(
    input.raid,
    input.communityConfig.policies.attemptLimit,
    input.notificationUserId,
    candidates?.source,
  );
}

type BoardSnapshot = Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>>;

interface BoardDrainStepResult {
  complete: boolean;
  hasMore: boolean;
  canonicalMessageId: string | undefined;
}

async function completedBoardDrainResult(
  repository: D1MvpRepository,
  completion: Awaited<ReturnType<D1MvpRepository["completeBoardDrain"]>>,
): Promise<BoardDrainStepResult> {
  if (!completion.applied) {
    return {
      complete: true,
      hasMore: false,
      canonicalMessageId: await repository.getCanonicalBoardMessageId(),
    };
  }
  return {
    complete: !completion.hasMore,
    hasMore: completion.hasMore,
    canonicalMessageId: completion.canonicalMessageId,
  };
}

async function createCanonicalBoardMessage(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  repository: D1MvpRepository;
  token: string;
  renderedVersion: number;
  expectedMessageId: string | null;
  message: DiscordBotMessage;
}): Promise<BoardDrainStepResult> {
  const created = await createDiscordMessage(
    input.environment,
    input.communityConfig.discord.staffChannelId,
    input.message,
  );
  let completion: Awaited<ReturnType<D1MvpRepository["completeBoardDrain"]>>;
  try {
    completion = await input.repository.completeBoardDrain({
      token: input.token,
      renderedVersion: input.renderedVersion,
      expectedMessageId: input.expectedMessageId,
      messageId: created.id,
      changedAt: new Date(),
    });
  } catch (error) {
    await deleteDuplicateRaidMessage({
      environment: input.environment,
      channelId: input.communityConfig.discord.staffChannelId,
      messageId: created.id,
    });
    throw error;
  }
  if (!completion.applied) {
    await deleteDuplicateRaidMessage({
      environment: input.environment,
      channelId: input.communityConfig.discord.staffChannelId,
      messageId: created.id,
    });
  }
  return completedBoardDrainResult(input.repository, completion);
}

async function updateCanonicalBoardMessage(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  repository: D1MvpRepository;
  token: string;
  renderedVersion: number;
  expectedMessageId: string;
  message: DiscordBotMessage;
  createIfMissing: boolean;
}): Promise<BoardDrainStepResult> {
  try {
    await updateDiscordMessage(
      input.environment,
      input.communityConfig.discord.staffChannelId,
      input.expectedMessageId,
      input.message,
    );
  } catch (error) {
    if (!(error instanceof DiscordApiError) || error.status !== 404 || !input.createIfMissing) {
      await input.repository.releaseBoardDrainLease(input.token);
      throw error;
    }
    return createCanonicalBoardMessage(input);
  }
  const completion = await input.repository.completeBoardDrain({
    token: input.token,
    renderedVersion: input.renderedVersion,
    expectedMessageId: input.expectedMessageId,
    changedAt: new Date(),
  });
  return completedBoardDrainResult(input.repository, completion);
}

async function drainCanonicalBoardLease(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  createIfMissing: boolean;
  repository: D1MvpRepository;
  token: string;
  lease: BoardDrainLease;
  reusableSnapshot: BoardSnapshot | undefined;
  captureSnapshot?: (snapshot: BoardSnapshot) => void;
}): Promise<BoardDrainStepResult> {
  const snapshot =
    input.reusableSnapshot?.boardVersion === input.lease.dirtyVersion
      ? input.reusableSnapshot
      : await input.repository.getBoardSnapshot(input.changedAt);
  input.captureSnapshot?.(snapshot);
  const message = boardMessage(snapshot, input.communityConfig);
  const renderedVersion = snapshot.boardVersion ?? input.lease.dirtyVersion;
  const expectedMessageId = input.lease.canonicalMessageId ?? null;
  if (expectedMessageId !== null) {
    return updateCanonicalBoardMessage({
      ...input,
      renderedVersion,
      expectedMessageId,
      message,
    });
  }
  if (!input.createIfMissing) {
    await input.repository.releaseBoardDrainLease(input.token);
    return { complete: true, hasMore: false, canonicalMessageId: undefined };
  }
  return createCanonicalBoardMessage({
    ...input,
    renderedVersion,
    expectedMessageId: null,
    message,
  });
}

export async function synchronizeCanonicalBoard(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  createIfMissing: boolean;
  context?: ExecutionContext | TrackedExecutionContext;
  snapshot?: BoardSnapshot;
  captureSnapshot?: (snapshot: BoardSnapshot) => void;
}): Promise<string | undefined> {
  const repository = new D1MvpRepository(input.environment.DB);
  const token = crypto.randomUUID();
  let canonicalMessageId = input.snapshot?.canonicalMessageId;
  let reusableSnapshot: BoardSnapshot | undefined = input.snapshot;
  let hasMore = false;
  // oxlint-disable no-await-in-loop -- Each lease/CAS step must finish before the next board version.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease = await repository.acquireBoardDrainLease({
      token,
      changedAt: new Date(),
      createIfMissing: input.createIfMissing,
    });
    if (lease === undefined) {
      if (!input.createIfMissing) return canonicalMessageId;
      const storedMessageId = canonicalMessageId ?? (await repository.getCanonicalBoardMessageId());
      if (storedMessageId !== undefined || attempt === 2) {
        return storedMessageId;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    const result = await drainCanonicalBoardLease({
      ...input,
      repository,
      token,
      lease,
      reusableSnapshot,
    });
    reusableSnapshot = undefined;
    canonicalMessageId = result.canonicalMessageId;
    hasMore = result.hasMore;
    if (result.complete) return canonicalMessageId;
  }
  // oxlint-enable no-await-in-loop
  await repository.releaseBoardDrainLease(token);
  if (hasMore && input.context !== undefined) {
    scheduleBackground(
      input.context,
      "discord.board_followup",
      input.environment,
      async (environment) => {
        await synchronizeCanonicalBoard({
          environment,
          communityConfig: input.communityConfig,
          changedAt: new Date(),
          createIfMissing: input.createIfMissing,
          ...(input.context === undefined ? {} : { context: input.context }),
        });
      },
    );
  }
  return canonicalMessageId;
}

async function deleteDuplicateRaidMessage(input: {
  environment: CloudflareEnvironment;
  channelId: string;
  messageId: string;
}): Promise<void> {
  try {
    await deleteDiscordMessage(input.environment, input.channelId, input.messageId);
  } catch {
    // The compare-and-set winner remains canonical even if Discord rejects duplicate cleanup.
  }
}

async function tryUpdateRaidMessage(input: {
  environment: CloudflareEnvironment;
  channelId: string;
  messageId: string;
  message: DiscordBotMessage;
}): Promise<"updated" | "missing" | "failed"> {
  try {
    await updateDiscordMessage(input.environment, input.channelId, input.messageId, input.message);
    return "updated";
  } catch (error) {
    return error instanceof DiscordApiError && error.status === 404 ? "missing" : "failed";
  }
}

async function reconcileRaidMessage(input: {
  raid: StaffBoardRaid;
  repository: D1MvpRepository;
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  pullCandidateSource?: StaffBoardRaid;
  candidatesPreloaded?: boolean;
}): Promise<string | null | undefined> {
  const current = input.raid;
  const isReviewedPlanned = current.state === "planned" && !current.automaticFill;
  if (current.state !== "active" && !isReviewedPlanned) return undefined;
  const channelId = input.communityConfig.discord.staffChannelId;
  const message = await raidDetailMessage({
    raid: current,
    repository: input.repository,
    communityConfig: input.communityConfig,
    ...(input.pullCandidateSource === undefined
      ? {}
      : { pullCandidateSource: input.pullCandidateSource }),
    ...(input.candidatesPreloaded === undefined
      ? {}
      : { candidatesPreloaded: input.candidatesPreloaded }),
  });
  if (current.staffMessageId !== undefined) {
    const updateResult = await tryUpdateRaidMessage({
      environment: input.environment,
      channelId,
      messageId: current.staffMessageId,
      message,
    });
    if (updateResult === "updated") {
      return current.staffMessageId;
    }
    if (updateResult === "failed") return undefined;
    if (current.state === "planned") {
      await input.repository.compareAndSetRaidStaffMessage({
        groupId: current.id,
        expectedMessageId: current.staffMessageId,
        changedAt: input.changedAt,
      });
      return null;
    }
  }
  const created = await createDiscordMessage(input.environment, channelId, message);
  try {
    const stored = await input.repository.compareAndSetRaidStaffMessage({
      groupId: current.id,
      ...(current.staffMessageId === undefined
        ? {}
        : { expectedMessageId: current.staffMessageId }),
      messageId: created.id,
      changedAt: input.changedAt,
    });
    if (!stored) {
      await deleteDuplicateRaidMessage({
        environment: input.environment,
        channelId,
        messageId: created.id,
      });
      return undefined;
    }
    return created.id;
  } catch (error) {
    await deleteDuplicateRaidMessage({
      environment: input.environment,
      channelId,
      messageId: created.id,
    });
    throw error;
  }
}

async function reconcileVisibleRaidMessages(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  context?: ExecutionContext | TrackedExecutionContext;
  snapshot: Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>>;
}): Promise<boolean> {
  const repository = new D1MvpRepository(input.environment.DB);
  const visibleRaids = [...input.snapshot.priorityRaids, ...input.snapshot.ordinaryRaids].filter(
    (raid) => raid.state === "active" || raid.staffMessageId !== undefined,
  );
  const reviewedIds = visibleRaids
    .filter(
      (raid) =>
        raid.state === "planned" &&
        !raid.automaticFill &&
        raid.members.length < raid.requesterCapacity,
    )
    .map((raid) => raid.id);
  const pullCandidates = await repository.getPullRequesterCandidatesForRaids(reviewedIds);
  const reconciled = await Promise.allSettled(
    visibleRaids.map((raid) => {
      const pullCandidateSource = pullCandidates.get(raid.id);
      return reconcileRaidMessage({
        ...input,
        raid,
        repository,
        candidatesPreloaded: true,
        ...(pullCandidateSource === undefined ? {} : { pullCandidateSource }),
      });
    }),
  );
  let identityChanged = false;
  for (const [index, result] of reconciled.entries()) {
    if (result.status !== "fulfilled" || result.value === undefined) continue;
    const raid = visibleRaids[index];
    if (raid === undefined) continue;
    if (result.value === null) {
      identityChanged ||= raid.staffMessageId !== undefined;
      delete raid.staffMessageId;
    } else {
      identityChanged ||= raid.staffMessageId !== result.value;
      raid.staffMessageId = result.value;
    }
  }
  return identityChanged;
}

async function sendRaidCalls(
  raid: StaffBoardRaid,
  dependencies: StaffBoardHandlerDependencies,
  repository: D1MvpRepository,
): Promise<void> {
  const { environment, communityConfig, changedAt } = dependencies;
  const resolvedMap = resolveTarkovMap(raid.mapId);
  const mapName = resolvedMap?.name ?? raid.mapId;
  const raidName = formatModeMap(raid.gameMode, mapName);
  const linkedUsers = [
    ...(raid.leaderDiscordUserId === undefined ? [] : [raid.leaderDiscordUserId]),
    ...raid.members.flatMap((member) =>
      member.discordUserId === undefined ? [] : [member.discordUserId],
    ),
  ];
  const uniqueUsers = [...new Set(linkedUsers)];
  const unlinkedNames = raid.members
    .filter((member) => member.discordUserId === undefined)
    .map((member) => `@${member.twitchLogin}`);
  const discordMentions = [...uniqueUsers.map((id) => `<@${id}>`), ...unlinkedNames].join(" ");
  const twitchMentions = raid.members.map((member) => `@${member.twitchLogin}`).join(" ");
  const startedAt = raid.startedAt;
  if (startedAt === undefined) {
    throw new RepositoryInvariantError("The active raid start time is missing.");
  }
  const persistStatus = async (
    platform: "discord" | "twitch",
    outcome: "sent" | "failed",
  ): Promise<void> => {
    try {
      await repository.updateCallStatus({
        groupId: raid.id,
        startedAt,
        platform,
        status: outcome,
        changedAt,
      });
    } catch {
      logDiagnostic("warn", "raid_call_status_write_failed", { platform, outcome });
    }
  };
  const sendDiscord = async (): Promise<void> => {
    const outcome = await createDiscordMessage(
      environment,
      communityConfig.discord.requestChannelId,
      {
        content: appendRaidBringSuffix(`Starting ${raidName}: ${discordMentions}`, resolvedMap),
        allowed_mentions: { parse: [], users: uniqueUsers },
      },
    )
      .then(() => "sent" as const)
      .catch(() => "failed" as const);
    await persistStatus("discord", outcome);
  };
  const sendTwitch = async (): Promise<void> => {
    if (raid.twitchCallStatus !== "pending") return;
    const outcome = await sendTwitchChatMessage(
      environment,
      {
        clientId: communityConfig.twitch.clientId,
        botUserId: communityConfig.twitch.botUserId,
      },
      {
        broadcasterId: communityConfig.twitch.broadcasterUserId,
        message: appendRaidBringSuffix(
          `Starting ${raidName}: ${twitchMentions}. Check Discord for details.`,
          resolvedMap,
        ),
      },
    )
      .then(() => "sent" as const)
      .catch(() => "failed" as const);
    await persistStatus("twitch", outcome);
  };
  await Promise.all([sendDiscord(), sendTwitch()]);
}

class StaffBoardHandler {
  private readonly repository: D1MvpRepository;

  constructor(private readonly dependencies: StaffBoardHandlerDependencies) {
    this.repository = new D1MvpRepository(dependencies.environment.DB);
  }

  private deferRestWork(
    interaction: StaffInteraction,
    name: string,
    work: (handler: StaffBoardHandler) => Promise<string>,
  ): Response {
    scheduleBackground(
      this.dependencies.context,
      name,
      this.dependencies.environment,
      async (environment) => {
        const handler = new StaffBoardHandler({ ...this.dependencies, environment });
        let content: string;
        try {
          content = await work(handler);
        } catch (error) {
          logDiagnostic("warn", "discord_deferred_staff_action_failed", { task: name });
          content =
            error instanceof RepositoryInvariantError
              ? error.message
              : "Discord could not finish that action. Try again.";
        }
        await updateDiscordInteractionResponse(
          environment,
          interaction.applicationId,
          interaction.interactionToken,
          { content, allowed_mentions: { parse: [] } },
        );
      },
    );
    return deferredEphemeral();
  }

  private async claimMutation(deliveryId: string, eventType: string): Promise<string | undefined> {
    return this.repository.claimDiscordMutation(
      deliveryId,
      eventType,
      this.dependencies.changedAt,
      new Date(),
    );
  }

  private async completeMutation(deliveryId: string, claimToken: string): Promise<void> {
    await this.repository.completeDiscordMutation(deliveryId, claimToken);
    scheduleBackground(
      this.dependencies.context,
      "discord.receipt_cleanup",
      this.dependencies.environment,
      async (environment) => {
        await new D1MvpRepository(environment.DB).maintainExpiredReceipts(
          this.dependencies.changedAt,
        );
      },
    );
  }

  private releaseMutation(deliveryId: string, claimToken: string): Promise<void> {
    return this.repository.releaseDiscordMutation(deliveryId, claimToken);
  }

  private refreshBoardLater(): void {
    scheduleBackground(
      this.dependencies.context,
      "discord.board_drain",
      this.dependencies.environment,
      async (environment) => {
        await synchronizeCanonicalBoard({
          environment,
          communityConfig: this.dependencies.communityConfig,
          changedAt: this.dependencies.changedAt,
          createIfMissing: false,
          ...(this.dependencies.context === undefined
            ? {}
            : { context: this.dependencies.context }),
        });
      },
    );
  }

  private reconcileBoardLater(
    snapshot: Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>>,
  ): void {
    scheduleBackground(
      this.dependencies.context,
      "discord.board_reconciliation",
      this.dependencies.environment,
      async (environment) => {
        const identityChanged = await reconcileVisibleRaidMessages({
          ...this.dependencies,
          environment,
          snapshot,
        });
        if (identityChanged) {
          new StaffBoardHandler({ ...this.dependencies, environment }).refreshBoardLater();
        }
      },
    );
  }

  private refreshAndReconcileBoardLater(): void {
    scheduleBackground(
      this.dependencies.context,
      "discord.board_drain",
      this.dependencies.environment,
      async (environment) => {
        const handler = new StaffBoardHandler({ ...this.dependencies, environment });
        let renderedSnapshot: BoardSnapshot | undefined;
        await synchronizeCanonicalBoard({
          environment,
          communityConfig: this.dependencies.communityConfig,
          changedAt: this.dependencies.changedAt,
          createIfMissing: false,
          captureSnapshot(snapshot) {
            renderedSnapshot = snapshot;
          },
          ...(this.dependencies.context === undefined
            ? {}
            : { context: this.dependencies.context }),
        });
        if (renderedSnapshot !== undefined) {
          handler.reconcileBoardLater(renderedSnapshot);
        }
      },
    );
  }

  private async ensureReviewMessage(
    raid: StaffBoardRaid,
    reviewerDiscordUserId: string,
  ): Promise<string | undefined> {
    const { communityConfig, changedAt, environment } = this.dependencies;
    const message = await raidDetailMessage({
      raid,
      repository: this.repository,
      communityConfig,
      notificationUserId: reviewerDiscordUserId,
    });
    if (raid.staffMessageId !== undefined) {
      try {
        await updateDiscordMessage(
          environment,
          communityConfig.discord.staffChannelId,
          raid.staffMessageId,
          message,
        );
        return raid.staffMessageId;
      } catch (error) {
        if (!(error instanceof DiscordApiError) || error.status !== 404) throw error;
      }
      await this.repository.compareAndSetRaidStaffMessage({
        groupId: raid.id,
        expectedMessageId: raid.staffMessageId,
        changedAt,
      });
      const retained = await this.repository.getRaid(raid.id);
      return retained?.staffMessageId;
    }
    const created = await createDiscordMessage(
      environment,
      communityConfig.discord.staffChannelId,
      message,
    );
    let stored: boolean;
    try {
      stored = await this.repository.compareAndSetRaidStaffMessage({
        groupId: raid.id,
        ...(raid.staffMessageId === undefined ? {} : { expectedMessageId: raid.staffMessageId }),
        messageId: created.id,
        changedAt,
      });
    } catch (error) {
      await deleteDuplicateRaidMessage({
        environment,
        channelId: communityConfig.discord.staffChannelId,
        messageId: created.id,
      });
      throw error;
    }
    if (stored) return created.id;
    await deleteDuplicateRaidMessage({
      environment,
      channelId: communityConfig.discord.staffChannelId,
      messageId: created.id,
    });
    const retained = await this.repository.getRaid(raid.id);
    if (retained?.staffMessageId !== undefined) return retained.staffMessageId;
    throw new RepositoryInvariantError("That raid is no longer available to review.");
  }

  private async deleteRaidMessage(messageId: string | undefined): Promise<boolean> {
    if (messageId === undefined) return true;
    try {
      await deleteDiscordMessage(
        this.dependencies.environment,
        this.dependencies.communityConfig.discord.staffChannelId,
        messageId,
      );
      return true;
    } catch (error) {
      return error instanceof DiscordApiError && error.status === 404;
    }
  }

  private async refreshPulledRaidMessage(raid: StaffBoardRaid): Promise<void> {
    const { communityConfig, environment } = this.dependencies;
    if (raid.staffMessageId === undefined) return;
    const message = await raidDetailMessage({
      raid,
      repository: this.repository,
      communityConfig,
    });
    try {
      await updateDiscordMessage(
        environment,
        communityConfig.discord.staffChannelId,
        raid.staffMessageId,
        message,
      );
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404) throw error;
      await reconcileRaidMessage({
        ...this.dependencies,
        raid,
        repository: this.repository,
      });
    }
  }

  open(interaction: StaffInteraction): Response {
    const { communityConfig } = this.dependencies;
    if (!hasAccess(interaction, communityConfig)) {
      return ephemeral("Use `/board` in the staff channel as the streamer or a volunteer sherpa.");
    }
    return this.deferRestWork(interaction, "discord.board_open", async (handler) => {
      let renderedSnapshot: Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>> | undefined;
      const messageId = await synchronizeCanonicalBoard({
        environment: handler.dependencies.environment,
        communityConfig,
        changedAt: handler.dependencies.changedAt,
        createIfMissing: true,
        captureSnapshot(snapshot) {
          renderedSnapshot = snapshot;
        },
        ...(handler.dependencies.context === undefined
          ? {}
          : { context: handler.dependencies.context }),
      });
      if (messageId === undefined) throw new Error("The canonical board was not created.");
      const currentSnapshot =
        renderedSnapshot ??
        (await handler.repository.getBoardSnapshot(handler.dependencies.changedAt));
      handler.reconcileBoardLater(currentSnapshot);
      return `[Open the sherpa board](${discordMessageUrl(
        communityConfig.discord.guildId,
        communityConfig.discord.staffChannelId,
        messageId,
      )})`;
    });
  }

  private async reviewRaid(interaction: DiscordMessageComponentInteraction): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const raidId = Number(selectedValue(interaction));
    if (!Number.isSafeInteger(raidId) || raidId < 1) {
      throw new RepositoryInvariantError("Choose a current raid to review.");
    }
    const reviewed = await this.repository.reviewRaid({ groupId: raidId, changedAt });
    return this.deferRestWork(interaction, "discord.raid_review", async (handler) => {
      const messageId = await handler.ensureReviewMessage(reviewed, interaction.discordUserId);
      handler.refreshBoardLater();
      if (messageId === undefined) {
        return "That review message was deleted. The raid is back on the board. Review it again to open new details.";
      }
      return `[Open raid details](${discordMessageUrl(
        communityConfig.discord.guildId,
        communityConfig.discord.staffChannelId,
        messageId,
      )})`;
    });
  }

  private async cancelReview(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { changedAt } = this.dependencies;
    const messageId = interaction.messageId;
    if (messageId === undefined) {
      throw new RepositoryInvariantError("That review control is out of date.");
    }
    const dismissed = await this.repository.dismissRaidReview({
      groupId: raid.id,
      expectedMessageId: messageId,
      changedAt,
    });
    if (!dismissed) {
      throw new RepositoryInvariantError("That review is no longer available to cancel.");
    }
    return this.deferRestWork(interaction, "discord.review_cancel", async (handler) => {
      const deleted = await handler.deleteRaidMessage(messageId);
      if (!deleted) {
        await handler.repository.compareAndSetRaidStaffMessage({
          groupId: raid.id,
          messageId,
          changedAt,
        });
        throw new RepositoryInvariantError(
          "Discord could not close that review. Try Cancel review again.",
        );
      }
      handler.refreshBoardLater();
      return "Review closed. The raid is still on the board.";
    });
  }

  private async showPullCandidates(raid: StaffBoardRaid): Promise<Response> {
    const candidates = await this.repository.getPullRequesterCandidates(raid.id);
    if (candidates === undefined) {
      return ephemeral("No later requester is available for this raid.");
    }
    return ephemeralMessage(renderPullRequesterSelector(raid, candidates.source));
  }

  private requesterId(interaction: DiscordMessageComponentInteraction): number {
    const requestId = Number(selectedValue(interaction));
    if (!Number.isSafeInteger(requestId) || requestId < 1) {
      throw new RepositoryInvariantError("Choose a current requester.");
    }
    return requestId;
  }

  private async pullRequester(
    interaction: DiscordMessageComponentInteraction,
    action: Extract<RaidMessageAction, { action: "pull" }>,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const pulled = await this.repository.pullRequester({
      destinationGroupId: raid.id,
      sourceGroupId: action.sourceRaidId,
      requestId: this.requesterId(interaction),
      actionKey: interaction.interactionId,
      changedAt: this.dependencies.changedAt,
    });
    scheduleBackground(
      this.dependencies.context,
      "discord.pulled_raid_detail",
      this.dependencies.environment,
      async (environment) => {
        await new StaffBoardHandler({ ...this.dependencies, environment }).refreshPulledRaidMessage(
          pulled.destination,
        );
      },
    );
    this.refreshBoardLater();
    if (pulled.sourceDisposition === "closed") {
      return ephemeral("Requester pulled up. The empty source raid was closed.");
    }
    if (pulled.sourceDisposition === "pushed") {
      return ephemeral(
        "Requester pulled up. The remaining source requesters moved to the next compatible raid.",
      );
    }
    return ephemeral("Requester pulled up. The remaining source raid stayed in place.");
  }

  private async callRaid(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
    isStreamer: boolean,
  ): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    if (raid.state !== "planned" || raid.staffMessageId === undefined) {
      throw new RepositoryInvariantError("That raid is no longer available to start.");
    }
    if (
      raid.leaderDiscordUserId !== undefined &&
      !isStreamer &&
      raid.leaderDiscordUserId !== interaction.discordUserId
    ) {
      throw new RepositoryInvariantError(
        "Only the reserved leader or streamer can start this postponed raid.",
      );
    }
    const started = await this.repository.startRaid({
      groupId: raid.id,
      leaderDiscordUserId: interaction.discordUserId,
      leaderType: isStreamer ? "streamer" : "volunteer",
      requestTwitchCall: isStreamer,
      canOverrideReservedLeader: isStreamer,
      changedAt,
    });
    scheduleBackground(
      this.dependencies.context,
      "discord.raid_calls",
      this.dependencies.environment,
      async (environment) => {
        await sendRaidCalls(
          started,
          { ...this.dependencies, environment },
          new D1MvpRepository(environment.DB),
        );
      },
    );
    this.refreshBoardLater();
    return update(renderRaidMessage(started, communityConfig.policies.attemptLimit));
  }

  private assertRaidControlAccess(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
    isStreamer: boolean,
  ): boolean {
    const isReviewedPlanned =
      raid.state === "planned" && !raid.automaticFill && raid.staffMessageId !== undefined;
    if (
      !isReviewedPlanned &&
      !isStreamer &&
      interaction.discordUserId !== raid.leaderDiscordUserId
    ) {
      throw new RepositoryInvariantError("Only this raid's leader or the streamer can use it.");
    }
    return isReviewedPlanned;
  }

  private async recordRaidResult(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const result = selectedValue(interaction);
    if (result !== "helped" && result !== "unsuccessful" && result !== "postpone_raid") {
      throw new RepositoryInvariantError("Choose an available raid result.");
    }
    if (result === "postpone_raid") {
      await this.repository.postponeRaid({
        groupId: raid.id,
        actionKey: interaction.interactionId,
        changedAt,
      });
      this.refreshBoardLater();
      return this.deferRestWork(interaction, "discord.postponed_raid_detail", async (handler) => {
        const deleted = await handler.deleteRaidMessage(raid.staffMessageId);
        return deleted
          ? "Raid postponed to the end of the Priority queue."
          : "Raid postponed to the end of the Priority queue, but its old details message could not be deleted.";
      });
    }
    const updatedRaid = await this.repository.recordRaidResult({
      groupId: raid.id,
      outcome: result,
      attemptLimit: communityConfig.policies.attemptLimit,
      actionKey: interaction.interactionId,
      changedAt,
    });
    this.refreshBoardLater();
    if (result !== "helped") {
      return update(renderRaidMessage(updatedRaid, communityConfig.policies.attemptLimit));
    }
    return this.deferRestWork(interaction, "discord.helped_raid_detail", async (handler) => {
      const deleted = await handler.deleteRaidMessage(raid.staffMessageId);
      return deleted
        ? "Raid recorded as Helped."
        : "Raid recorded as Helped, but its old details message could not be deleted.";
    });
  }

  private async removeRequester(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const updated = await this.repository.removeRequester({
      groupId: raid.id,
      requestId: this.requesterId(interaction),
      actionKey: interaction.interactionId,
      changedAt,
    });
    this.refreshBoardLater();
    if (updated.state !== "canceled") {
      return update(
        await raidDetailMessage({
          raid: updated,
          repository: this.repository,
          communityConfig,
        }),
      );
    }
    return this.deferRestWork(interaction, "discord.removed_raid_detail", async (handler) => {
      const deleted = await handler.deleteRaidMessage(raid.staffMessageId);
      return deleted
        ? "Requester removed. The empty raid was closed."
        : "Requester removed and the empty raid was closed, but its old details message could not be deleted.";
    });
  }

  private async postponeRequester(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const postponed = await this.repository.postponeRequester({
      groupId: raid.id,
      requestId: this.requesterId(interaction),
      actionKey: interaction.interactionId,
      changedAt,
    });
    this.refreshBoardLater();
    if (postponed.source.state !== "canceled") {
      return update(
        await raidDetailMessage({
          raid: postponed.source,
          repository: this.repository,
          communityConfig,
        }),
      );
    }
    return this.deferRestWork(
      interaction,
      "discord.postponed_requester_detail",
      async (handler) => {
        const deleted = await handler.deleteRaidMessage(raid.staffMessageId);
        return deleted
          ? "Requester postponed to the next raid. The empty raid was closed."
          : "Requester postponed and the empty raid was closed, but its old details message could not be deleted.";
      },
    );
  }

  private async handleRaidAction(
    interaction: DiscordMessageComponentInteraction,
    action: RaidMessageAction,
  ): Promise<Response> {
    const { communityConfig } = this.dependencies;
    const raid = await this.repository.getRaid(action.raidId);
    if (raid === undefined) throw new RepositoryInvariantError("That raid no longer exists.");
    const isStreamer = interaction.discordUserId === communityConfig.discord.streamerUserId;
    if (action.action === "cancel") return this.cancelReview(interaction, raid);
    if (action.action === "pull_candidates") return this.showPullCandidates(raid);
    if (action.action === "pull") return this.pullRequester(interaction, action, raid);
    if (action.action === "call") return this.callRaid(interaction, raid, isStreamer);

    const isReviewedPlanned = this.assertRaidControlAccess(interaction, raid, isStreamer);
    if (isReviewedPlanned && action.action === "result") {
      throw new RepositoryInvariantError("Call and start this raid before recording a result.");
    }
    if (action.action === "result") return this.recordRaidResult(interaction, raid);
    if (action.action === "remove") return this.removeRequester(interaction, raid);
    return this.postponeRequester(interaction, raid);
  }

  async handle(interaction: DiscordMessageComponentInteraction): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    if (!hasAccess(interaction, communityConfig)) {
      return ephemeral("Only the streamer or a volunteer sherpa can use these controls.");
    }
    const boardAction = parseStaffBoardAction(interaction.customId);
    const raidAction = parseRaidMessageAction(interaction.customId);
    if (boardAction === undefined && raidAction === undefined) {
      return new Response("Unsupported component", { status: 400 });
    }
    if (boardAction?.action === "retired_start") {
      return ephemeral("This board is out of date. Use Refresh, then review the raid again.");
    }
    if (boardAction?.action === "refresh") {
      await this.repository.markBoardDirty(changedAt);
      this.refreshAndReconcileBoardLater();
      return ephemeral("Refreshing the sherpa board.");
    }
    const claimToken = await this.claimMutation(
      interaction.interactionId,
      boardAction === undefined ? `raid:${raidAction?.action}` : "raid:review",
    );
    if (claimToken === undefined) {
      return ephemeral("That action was already received.");
    }
    try {
      let response: Response;
      if (boardAction?.action === "review") {
        response = await this.reviewRaid(interaction);
      } else {
        if (raidAction === undefined) {
          await this.completeMutation(interaction.interactionId, claimToken);
          return new Response("Unsupported component", { status: 400 });
        }
        response = await this.handleRaidAction(interaction, raidAction);
      }
      await this.completeMutation(interaction.interactionId, claimToken);
      return response;
    } catch (error) {
      if (error instanceof RepositoryInvariantError) {
        await this.completeMutation(interaction.interactionId, claimToken);
        return ephemeral(error.message);
      }
      await this.releaseMutation(interaction.interactionId, claimToken);
      throw error;
    }
  }
}

export function openDiscordStaffBoard(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: StaffBoardHandlerDependencies,
): Promise<Response> {
  return Promise.resolve(new StaffBoardHandler(dependencies).open(interaction));
}

export function handleDiscordStaffBoardComponent(
  interaction: DiscordMessageComponentInteraction,
  dependencies: StaffBoardHandlerDependencies,
): Promise<Response> {
  return new StaffBoardHandler(dependencies).handle(interaction);
}

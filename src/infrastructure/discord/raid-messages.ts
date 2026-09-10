import type { CommunityConfig } from "../../config/community";
import { RepositoryInvariantError } from "../../domain/sherpa-repository";
import type { PullRequesterSource, StaffBoardRaid } from "../../domain/staff-board";
import { type BoardDrainLease, D1MvpRepository } from "../cloudflare/d1-mvp-repository";
import type { CloudflareEnvironment } from "../cloudflare/environment";
import { scheduleBackground, type TrackedExecutionContext } from "../cloudflare/telemetry";
import {
  createDiscordMessage,
  DiscordApiError,
  deleteDiscordMessage,
  updateDiscordMessage,
} from "./messages";
import { type DiscordBotMessage, renderRaidMessage, renderStaffBoard } from "./staff-board";

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

export async function raidDetailMessage(input: {
  raid: StaffBoardRaid;
  repository: D1MvpRepository;
  communityConfig: CommunityConfig;
  notificationUserId?: string;
  pullCandidateSource?: PullRequesterSource;
  candidatesPreloaded?: boolean;
}): Promise<DiscordBotMessage> {
  const canPull =
    (input.raid.state === "planned" || input.raid.state === "active") &&
    !input.raid.automaticFill &&
    input.raid.members.length < input.raid.requesterCapacity;
  let candidates: { source: PullRequesterSource } | undefined;
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

interface RaidDetailsInput {
  raid: StaffBoardRaid;
  repository: D1MvpRepository;
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  reason: "review" | "refresh" | "pull";
  notificationUserId?: string;
  pullCandidateSource?: PullRequesterSource;
  candidatesPreloaded?: boolean;
}

async function retainedReviewMessage(input: RaidDetailsInput): Promise<string | undefined> {
  return (await input.repository.getRaid(input.raid.id))?.staffMessageId;
}

async function createRaidDetails(
  input: RaidDetailsInput,
  message: DiscordBotMessage,
): Promise<string | undefined> {
  const channelId = input.communityConfig.discord.staffChannelId;
  const created = await createDiscordMessage(input.environment, channelId, message);
  let stored: boolean;
  try {
    stored = await input.repository.compareAndSetRaidStaffMessage({
      groupId: input.raid.id,
      ...(input.raid.staffMessageId === undefined
        ? {}
        : { expectedMessageId: input.raid.staffMessageId }),
      messageId: created.id,
      changedAt: input.changedAt,
    });
  } catch (error) {
    await deleteDuplicateRaidMessage({
      environment: input.environment,
      channelId,
      messageId: created.id,
    });
    throw error;
  }
  if (stored) return created.id;
  await deleteDuplicateRaidMessage({
    environment: input.environment,
    channelId,
    messageId: created.id,
  });
  if (input.reason !== "review") return undefined;
  const retained = await retainedReviewMessage(input);
  if (retained !== undefined) return retained;
  throw new RepositoryInvariantError("That raid is no longer available to review.");
}

async function updateRaidDetails(
  input: RaidDetailsInput,
  message: DiscordBotMessage,
  messageId: string,
): Promise<string | null | undefined> {
  try {
    await updateDiscordMessage(
      input.environment,
      input.communityConfig.discord.staffChannelId,
      messageId,
      message,
    );
    return messageId;
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return null;
    if (input.reason === "refresh") return undefined;
    throw error;
  }
}

async function dismissReviewedDetails(
  input: RaidDetailsInput,
  messageId: string,
): Promise<string | null | undefined> {
  await input.repository.compareAndSetRaidStaffMessage({
    groupId: input.raid.id,
    expectedMessageId: messageId,
    changedAt: input.changedAt,
  });
  return input.reason === "review" ? retainedReviewMessage(input) : null;
}

export async function synchronizeRaidDetails(
  input: RaidDetailsInput,
): Promise<string | null | undefined> {
  const { raid } = input;
  if (input.reason === "pull" && raid.staffMessageId === undefined) return undefined;
  const reviewed = raid.state === "planned" && !raid.automaticFill;
  if (raid.state !== "active" && !reviewed) return undefined;
  // Only an explicit Review can create planned details after their dismissal.
  if (raid.staffMessageId === undefined && raid.state === "planned" && input.reason !== "review")
    return undefined;
  const message = await raidDetailMessage(input);
  if (raid.staffMessageId !== undefined) {
    const updated = await updateRaidDetails(input, message, raid.staffMessageId);
    if (updated !== null) return updated;
    if (raid.state === "planned") {
      return dismissReviewedDetails(input, raid.staffMessageId);
    }
  }
  return createRaidDetails(input, message);
}

export async function reconcileVisibleRaidMessages(input: {
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
        (raid.state === "planned" || raid.state === "active") &&
        !raid.automaticFill &&
        raid.members.length < raid.requesterCapacity,
    )
    .map((raid) => raid.id);
  const pullCandidates = await repository.getPullRequesterCandidatesForRaids(reviewedIds);
  const reconciled = await Promise.allSettled(
    visibleRaids.map((raid) => {
      const pullCandidateSource = pullCandidates.get(raid.id);
      return synchronizeRaidDetails({
        ...input,
        raid,
        repository,
        candidatesPreloaded: true,
        reason: "refresh",
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

export async function deleteRaidDetailMessage(
  input: {
    environment: CloudflareEnvironment;
    communityConfig: CommunityConfig;
  },
  messageId: string | undefined,
): Promise<boolean> {
  if (messageId === undefined) return true;
  try {
    await deleteDiscordMessage(
      input.environment,
      input.communityConfig.discord.staffChannelId,
      messageId,
    );
    return true;
  } catch (error) {
    return error instanceof DiscordApiError && error.status === 404;
  }
}

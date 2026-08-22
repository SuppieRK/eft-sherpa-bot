import {
  communityConfigFromEnvironment,
  type CommunityConfig,
  validateCommunityConfig,
} from "./config/community";
import { QueueQueryService } from "./domain/queue-queries";
import { StaffStatisticsQueryService } from "./domain/staff-statistics";
import { formatModeMap, parseGameMode } from "./domain/game-mode";
import { resolveTarkovMap } from "./domain/maps/catalog";
import { parseTwitchRequestInput } from "./domain/twitch-request";
import { isStaffBoardMember } from "./domain/staff-board";
import { StableTwitchIdentityConflictError } from "./domain/sherpa-repository";
import {
  D1MvpRepository,
  type TwitchReplyDeliveryClaim,
} from "./infrastructure/cloudflare/d1-mvp-repository";
import { logDiagnostic } from "./infrastructure/cloudflare/diagnostics";
import type { CloudflareEnvironment } from "./infrastructure/cloudflare/environment";
import { requireEnvironmentValue } from "./infrastructure/cloudflare/environment";
import {
  observeWorkerRequest,
  type TrackedExecutionContext,
} from "./infrastructure/cloudflare/telemetry";
import {
  DISCORD_EPHEMERAL_MESSAGE_FLAG,
  DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
  DISCORD_INTERACTION_RESPONSE_MODAL,
  DISCORD_INTERACTION_RESPONSE_PONG,
  DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE,
  parseDiscordInteraction,
  readDiscordInteractionTimestamp,
  type DiscordApplicationCommandInteraction,
  type DiscordMessageComponentInteraction,
  type ParsedDiscordInteraction,
  verifyDiscordInteractionRequest,
} from "./infrastructure/discord/interactions";
import {
  buildTwitchLinkedReply,
  DISCORD_LINK_TWITCH_COMMAND,
  parseEftNameOption,
  parseTwitchNameOption,
} from "./infrastructure/discord/link-twitch";
import {
  buildDiscordRequestCreatedReply,
  buildDiscordRequestModal,
  buildDiscordRequestValidationReply,
  DISCORD_REQUEST_COMMAND,
  DISCORD_REQUEST_MODAL_V2_PREFIX,
  requestModalGameMode,
  validateDiscordRequestModal,
} from "./infrastructure/discord/request-form";
import {
  handleDiscordStaffBoardComponent,
  openDiscordStaffBoard,
  synchronizeCanonicalBoard,
} from "./infrastructure/discord/staff-board-handler";
import {
  DISCORD_STAFF_BOARD_COMMAND,
  parseRaidMessageAction,
  parseStaffBoardAction,
} from "./infrastructure/discord/staff-board";
import {
  buildEftNameModal,
  DISCORD_STAFF_STATS_COMMAND,
  DISCORD_STAFF_USERS_COMMAND,
  parseUserDirectoryAction,
  renderStaffStatistics,
  renderUserDetail,
  renderUserDirectory,
  type StaffInsightsMessage,
  USER_DIRECTORY_EFT_FIELD,
} from "./infrastructure/discord/staff-insights";
import {
  parseEventSubChallenge,
  parseTwitchChatMessageEvent,
  verifyTwitchEventSubRequest,
} from "./infrastructure/twitch/eventsub";
import {
  parseTwitchPublicCommand,
  type TwitchPublicCommand,
} from "./infrastructure/twitch/public-commands";
import {
  sendTwitchChatMessage,
  TwitchApiError,
  type TwitchAuthorizationHealth,
  validateTwitchAuthorization,
} from "./infrastructure/twitch/twitch-api";
import { renderQueueFacts } from "./presentation/public-responses";

function discordEphemeralMessage(content: string, components?: unknown[]): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data: {
      content,
      flags: DISCORD_EPHEMERAL_MESSAGE_FLAG,
      allowed_mentions: { parse: [] },
      ...(components === undefined ? {} : { components }),
    },
  });
}

function discordEphemeralInsights(message: StaffInsightsMessage): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data: { ...message, flags: DISCORD_EPHEMERAL_MESSAGE_FLAG },
  });
}

function discordUpdateInsights(message: StaffInsightsMessage): Response {
  return Response.json({ type: DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE, data: message });
}

function hasStaffAccess(
  interaction: {
    channelId: string;
    discordUserId: string;
    discordRoleIds: readonly string[];
  },
  communityConfig: CommunityConfig,
): boolean {
  return (
    interaction.channelId === communityConfig.discord.staffChannelId &&
    isStaffBoardMember({
      discordUserId: interaction.discordUserId,
      discordRoleIds: interaction.discordRoleIds,
      streamerDiscordUserId: communityConfig.discord.streamerUserId,
      volunteerRoleId: communityConfig.discord.volunteerRoleId,
    })
  );
}

function staffDenied(): Response {
  return discordEphemeralMessage(
    "Use this command in the staff channel as the streamer or a volunteer sherpa.",
  );
}

function getTwitchAuthorizationRecovery(
  authorization: TwitchAuthorizationHealth,
): { action: "refresh_twitch_app_token"; operatorCommand: "npm run twitch:token" } | undefined {
  if (authorization.ok || !["revoked_or_expired", "wrong_client"].includes(authorization.reason)) {
    return undefined;
  }
  return { action: "refresh_twitch_app_token", operatorCommand: "npm run twitch:token" };
}

type DiscordModalSubmitInteraction = Extract<ParsedDiscordInteraction, { type: "modal_submit" }>;
type UserDirectoryAction = NonNullable<ReturnType<typeof parseUserDirectoryAction>>;
type UserDirectoryEditAction = Extract<UserDirectoryAction, { twitchLogin: string }>;

interface DiscordInteractionDependencies {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  context: TrackedExecutionContext;
  changedAt: Date;
  repository: D1MvpRepository;
}

async function claimDiscordMutation(
  dependencies: DiscordInteractionDependencies,
  deliveryId: string,
  eventType: string,
): Promise<string | undefined> {
  return dependencies.repository.claimDiscordMutation(
    deliveryId,
    eventType,
    dependencies.changedAt,
    new Date(),
  );
}

async function completeDiscordMutation(
  dependencies: DiscordInteractionDependencies,
  deliveryId: string,
  claimToken: string,
): Promise<void> {
  await dependencies.repository.completeDiscordMutation(deliveryId, claimToken);
  dependencies.context.waitUntilTask("discord.receipt_cleanup", async (environment) => {
    await new D1MvpRepository(environment.DB).maintainExpiredReceipts(dependencies.changedAt);
  });
}

async function releaseDiscordMutation(
  dependencies: DiscordInteractionDependencies,
  deliveryId: string,
  claimToken: string,
): Promise<void> {
  await dependencies.repository.releaseDiscordMutation(deliveryId, claimToken);
}

async function handleStaffInsightsCommand(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, repository } = dependencies;
  if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
  if (interaction.commandName === DISCORD_STAFF_STATS_COMMAND) {
    const service = new StaffStatisticsQueryService(repository);
    return discordEphemeralInsights(renderStaffStatistics(await service.getAllTime()));
  }
  return discordEphemeralInsights(
    renderUserDirectory(await repository.getUserDirectoryPage({ direction: "first" })),
  );
}

async function handleDiscordRequestCommand(
  interaction: DiscordApplicationCommandInteraction,
  repository: D1MvpRepository,
): Promise<Response> {
  const gameMode = parseGameMode(interaction.options.mode);
  if (gameMode === undefined) {
    return discordEphemeralMessage("Select PvP Seasonal, PvP, or PvE, then try again.");
  }
  const mapping = await repository.findUserMappingByDiscordId(interaction.discordUserId);
  let defaults: Parameters<typeof buildDiscordRequestModal>[1];
  if (mapping !== undefined) {
    defaults = { twitchLogin: mapping.twitchLogin };
    if (mapping.inGameName !== undefined) defaults.inGameName = mapping.inGameName;
  }
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_MODAL,
    data: buildDiscordRequestModal(gameMode, defaults),
  });
}

async function handleDiscordLinkCommand(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, changedAt, repository } = dependencies;
  const twitchLogin = parseTwitchNameOption(interaction.options.name);
  if (twitchLogin === undefined) {
    return discordEphemeralMessage("Enter a Twitch name using letters, numbers, or underscore.");
  }
  const rawEftName = interaction.options.eft;
  const inGameName = parseEftNameOption(rawEftName);
  if (rawEftName !== undefined && inGameName === undefined) {
    return discordEphemeralMessage("Enter an Escape from Tarkov name between 1 and 64 characters.");
  }
  const selectsDiscordMember = interaction.options.discord !== undefined;
  const targetDiscordUserId = interaction.options.discord ?? interaction.discordUserId;
  if (
    selectsDiscordMember &&
    !isStaffBoardMember({
      discordUserId: interaction.discordUserId,
      discordRoleIds: interaction.discordRoleIds,
      streamerDiscordUserId: communityConfig.discord.streamerUserId,
      volunteerRoleId: communityConfig.discord.volunteerRoleId,
    })
  ) {
    return discordEphemeralMessage(
      "Only the streamer or a volunteer sherpa can use the Discord member option.",
    );
  }
  const claimToken = await claimDiscordMutation(
    dependencies,
    interaction.interactionId,
    "identity:link-twitch",
  );
  if (claimToken === undefined)
    return discordEphemeralMessage("That link command was already received.");
  try {
    const discordDisplayName =
      targetDiscordUserId === interaction.discordUserId
        ? interaction.discordDisplayName
        : interaction.resolvedUserDisplayNames[targetDiscordUserId];
    await repository.linkDiscordToTwitch({
      twitchLogin,
      discordUserId: targetDiscordUserId,
      ...(discordDisplayName === undefined ? {} : { discordDisplayName }),
      ...(inGameName === undefined ? {} : { inGameName }),
      linkedAt: changedAt,
    });
    await completeDiscordMutation(dependencies, interaction.interactionId, claimToken);
    return discordEphemeralMessage(
      buildTwitchLinkedReply(twitchLogin, targetDiscordUserId, inGameName),
    );
  } catch (error) {
    await releaseDiscordMutation(dependencies, interaction.interactionId, claimToken);
    throw error;
  }
}

async function handleDiscordQueueCommand(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { repository } = dependencies;
  const queryService = new QueueQueryService(repository);
  return discordEphemeralMessage(
    renderQueueFacts(
      await queryService.queue({ platform: "discord", userId: interaction.discordUserId }),
      "discord",
    ),
  );
}

async function handleDiscordApplicationCommand(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  if (
    interaction.commandName === DISCORD_STAFF_STATS_COMMAND ||
    interaction.commandName === DISCORD_STAFF_USERS_COMMAND
  ) {
    return handleStaffInsightsCommand(interaction, dependencies);
  }
  if (interaction.commandName === DISCORD_STAFF_BOARD_COMMAND) {
    return openDiscordStaffBoard(interaction, dependencies);
  }
  if (interaction.commandName === DISCORD_REQUEST_COMMAND) {
    return handleDiscordRequestCommand(interaction, dependencies.repository);
  }
  if (interaction.commandName === DISCORD_LINK_TWITCH_COMMAND) {
    return handleDiscordLinkCommand(interaction, dependencies);
  }
  if (interaction.commandName === "queue") {
    return handleDiscordQueueCommand(interaction, dependencies);
  }
  return new Response("Unsupported application command", { status: 400 });
}

function updatedUserDetail(
  outcome: "updated" | "stale",
  entry: Awaited<ReturnType<D1MvpRepository["findUserMappingByTwitchLogin"]>>,
  pageFirst: string,
): Response {
  if (outcome === "updated" && entry !== undefined) {
    return discordUpdateInsights(renderUserDetail(entry, pageFirst));
  }
  return discordEphemeralMessage("User details changed. Open `/users` again.");
}

async function completeMissingDiscord(
  interaction: DiscordMessageComponentInteraction,
  action: UserDirectoryEditAction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { repository, changedAt } = dependencies;
  const discordUserId = interaction.values[0];
  const hasResolvedMember =
    discordUserId !== undefined && Object.hasOwn(interaction.resolvedRoleIdsByUser, discordUserId);
  if (!hasResolvedMember || discordUserId === undefined) {
    return discordEphemeralMessage("Select a current member of this Discord server.");
  }
  const claimToken = await claimDiscordMutation(
    dependencies,
    interaction.interactionId,
    "identity:complete-discord",
  );
  if (claimToken === undefined) {
    return discordEphemeralMessage("That user update was already received. Open `/users` again.");
  }
  try {
    const discordDisplayName = interaction.resolvedUserDisplayNames[discordUserId];
    const result = await repository.completeMissingDiscordAndGet({
      twitchLogin: action.twitchLogin,
      discordUserId,
      ...(discordDisplayName === undefined ? {} : { discordDisplayName }),
      changedAt,
    });
    await completeDiscordMutation(dependencies, interaction.interactionId, claimToken);
    return updatedUserDetail(result.outcome, result.entry, action.pageFirst);
  } catch (error) {
    await releaseDiscordMutation(dependencies, interaction.interactionId, claimToken);
    throw error;
  }
}

async function handleUserDirectoryComponent(
  interaction: DiscordMessageComponentInteraction,
  action: UserDirectoryAction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, repository } = dependencies;
  if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
  if (action.action === "next" || action.action === "previous" || action.action === "at") {
    const page = await repository.getUserDirectoryPage({
      direction: action.action,
      cursor: action.cursor,
    });
    return discordUpdateInsights(renderUserDirectory(page));
  }
  if (action.action === "detail") {
    const twitchLogin = interaction.values[0];
    const entry =
      twitchLogin === undefined
        ? undefined
        : await repository.findUserMappingByTwitchLogin(twitchLogin);
    if (entry === undefined) {
      return discordEphemeralMessage("Open `/users` again and select a current user.");
    }
    return discordUpdateInsights(renderUserDetail(entry, action.pageFirst));
  }
  if (action.action === "add_eft") {
    return Response.json({
      type: DISCORD_INTERACTION_RESPONSE_MODAL,
      data: buildEftNameModal(action.twitchLogin, action.pageFirst),
    });
  }
  if (action.action === "add_discord") {
    return completeMissingDiscord(interaction, action, dependencies);
  }
  return discordEphemeralMessage("Open `/users` again and use a current control.");
}

async function handleDiscordMessageComponent(
  interaction: DiscordMessageComponentInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const directoryAction = parseUserDirectoryAction(interaction.customId);
  if (directoryAction !== undefined) {
    return handleUserDirectoryComponent(interaction, directoryAction, dependencies);
  }
  const isBoardControl =
    parseStaffBoardAction(interaction.customId) !== undefined ||
    parseRaidMessageAction(interaction.customId) !== undefined;
  if (isBoardControl) {
    return handleDiscordStaffBoardComponent(interaction, dependencies);
  }
  if (interaction.customId.startsWith("users:")) {
    return discordEphemeralMessage("Open `/users` again and use a current control.");
  }
  return new Response("Unsupported component", { status: 400 });
}

async function handleUserDirectoryEftModal(
  interaction: DiscordModalSubmitInteraction,
  action: UserDirectoryEditAction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, repository, changedAt } = dependencies;
  if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
  const inGameName = interaction.values[USER_DIRECTORY_EFT_FIELD]?.trim();
  if (inGameName === undefined || inGameName.length < 1 || inGameName.length > 64) {
    return discordEphemeralMessage("Enter an Escape from Tarkov name from 1 to 64 characters.");
  }
  const claimToken = await claimDiscordMutation(
    dependencies,
    interaction.interactionId,
    "identity:complete-eft",
  );
  if (claimToken === undefined) {
    return discordEphemeralMessage("That user update was already received. Open `/users` again.");
  }
  const result = await repository
    .completeMissingInGameNameAndGet({
      twitchLogin: action.twitchLogin,
      inGameName,
      changedAt,
    })
    .catch(async (error: unknown) => {
      await releaseDiscordMutation(dependencies, interaction.interactionId, claimToken);
      throw error;
    });
  await completeDiscordMutation(dependencies, interaction.interactionId, claimToken);
  return updatedUserDetail(result.outcome, result.entry, action.pageFirst);
}

async function handleDiscordRequestModal(
  interaction: DiscordModalSubmitInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, context, changedAt, repository } = dependencies;
  const gameMode = requestModalGameMode(interaction.customId);
  if (gameMode === undefined) {
    if (interaction.customId.startsWith(DISCORD_REQUEST_MODAL_V2_PREFIX)) {
      return discordEphemeralMessage("Select a valid game mode and open `/request` again.");
    }
    return new Response("Unsupported modal", { status: 400 });
  }
  const validation = validateDiscordRequestModal(interaction.values, gameMode);
  if (!validation.valid) {
    return discordEphemeralMessage(buildDiscordRequestValidationReply(validation));
  }
  const created = await repository.createRequest({
    sourcePlatform: "discord",
    sourceDeliveryId: interaction.interactionId,
    discordUserId: interaction.discordUserId,
    ...(interaction.discordDisplayName === undefined
      ? {}
      : { discordDisplayName: interaction.discordDisplayName }),
    twitchLogin: validation.value.twitchLogin,
    gameMode: validation.value.gameMode,
    inGameName: validation.value.inGameName,
    mapId: validation.value.mapId,
    objective: validation.value.objective,
    ...(validation.value.notes === undefined ? {} : { notes: validation.value.notes }),
    recipientLimit: communityConfig.policies.recipientLimit,
    observedAt: changedAt,
  });
  if (created.queueChanged) {
    context.waitUntilTask("discord.board_drain", async (backgroundEnvironment) => {
      await synchronizeCanonicalBoard({
        environment: backgroundEnvironment,
        communityConfig,
        changedAt,
        createIfMissing: false,
        context,
      });
    });
  }
  const mapName = resolveTarkovMap(validation.value.mapId)?.name ?? validation.value.mapId;
  return discordEphemeralMessage(
    buildDiscordRequestCreatedReply(validation.value.gameMode, mapName, created.outcome),
  );
}

async function handleDiscordModalSubmit(
  interaction: DiscordModalSubmitInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const userAction = parseUserDirectoryAction(interaction.customId);
  if (userAction?.action === "add_eft") {
    return handleUserDirectoryEftModal(interaction, userAction, dependencies);
  }
  if (interaction.customId.startsWith("users:")) {
    return discordEphemeralMessage("Open `/users` again and use a current control.");
  }
  return handleDiscordRequestModal(interaction, dependencies);
}

async function handleDiscordInteraction(
  request: Request,
  environment: CloudflareEnvironment,
  communityConfig: CommunityConfig,
  context: TrackedExecutionContext,
): Promise<Response> {
  const rawBody = await request.text();
  const verified = await verifyDiscordInteractionRequest(
    request.headers,
    rawBody,
    communityConfig.discord.publicKey,
    new Date(),
  );
  if (!verified) return new Response("Invalid request signature", { status: 401 });
  const parsedBody = parseJsonBody(rawBody);
  if (!parsedBody.ok) return new Response("Invalid JSON", { status: 400 });
  const interaction = parseDiscordInteraction(parsedBody.payload);
  if (interaction === undefined) {
    return new Response("Unsupported interaction", { status: 400 });
  }
  if (interaction.type === "ping") {
    return Response.json({ type: DISCORD_INTERACTION_RESPONSE_PONG });
  }
  if (
    interaction.applicationId !== communityConfig.discord.applicationId ||
    interaction.guildId !== communityConfig.discord.guildId
  ) {
    return new Response("Unexpected Discord community", { status: 403 });
  }
  const dependencies: DiscordInteractionDependencies = {
    environment,
    communityConfig,
    context,
    changedAt: readDiscordInteractionTimestamp(request.headers),
    repository: new D1MvpRepository(environment.DB),
  };
  if (interaction.type === "application_command") {
    return handleDiscordApplicationCommand(interaction, dependencies);
  }
  if (interaction.type === "message_component") {
    return handleDiscordMessageComponent(interaction, dependencies);
  }
  return handleDiscordModalSubmit(interaction, dependencies);
}

async function buildTwitchPublicReply(
  command: TwitchPublicCommand,
  twitchUserId: string,
  twitchLogin: string,
  deliveryId: string,
  observedAt: Date,
  repository: D1MvpRepository,
  communityConfig: CommunityConfig,
): Promise<{ replyText: string; boardChanged: boolean }> {
  if (command.name === "request") {
    const parsed = parseTwitchRequestInput(command.input);
    if (!parsed.valid) {
      return { replyText: invalidTwitchRequestReply(parsed), boardChanged: false };
    }
    const result = await repository.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: deliveryId,
      twitchUserId,
      twitchLogin,
      gameMode: parsed.gameMode,
      inGameName: twitchLogin,
      mapId: parsed.map.id,
      objective: parsed.goal,
      recipientLimit: communityConfig.policies.recipientLimit,
      observedAt,
    });
    const raidName = formatModeMap(parsed.gameMode, parsed.map.name);
    return {
      replyText:
        result.outcome === "already_active"
          ? `You are already queued for ${raidName}. Use !queue to check it.`
          : `You are queued for ${raidName}. Use !queue to check it.`,
      boardChanged: result.queueChanged,
    };
  }
  await repository.observeTwitchIdentity({
    twitchUserId,
    twitchLogin,
    observedAt,
  });
  const queryService = new QueueQueryService(repository);
  return {
    replyText: renderQueueFacts(
      await queryService.queue({ platform: "twitch", userId: twitchUserId }),
      "twitch",
    ),
    boardChanged: false,
  };
}

type InvalidTwitchRequest = Extract<ReturnType<typeof parseTwitchRequestInput>, { valid: false }>;

function invalidTwitchRequestReply(parsed: InvalidTwitchRequest): string {
  if (parsed.reason === "missing_mode" || parsed.reason === "unknown_mode") {
    return "Use !request [mode] [map] [goal]. Modes: seasonal, pvp, pve.";
  }
  if (parsed.reason === "missing_map") {
    return "Use !request [mode] [map] [goal].";
  }
  if (parsed.reason === "goal_too_long") {
    return "Keep the goal to 150 characters or fewer.";
  }
  if (parsed.suggestion === undefined) {
    return "I do not know that map. Use !request [mode] [map] [goal].";
  }
  return `Did you mean ${parsed.suggestion.name}? Try !request ${parsed.gameMode ?? "pve"} ${parsed.suggestion.id} [goal].`;
}

type VerifiedEventSubHeaders = Extract<
  Awaited<ReturnType<typeof verifyTwitchEventSubRequest>>,
  { ok: true }
>["headers"];
type TwitchChatEvent = NonNullable<ReturnType<typeof parseTwitchChatMessageEvent>>;

function parseJsonBody(rawBody: string): { ok: true; payload: unknown } | { ok: false } {
  try {
    return { ok: true, payload: JSON.parse(rawBody) };
  } catch {
    return { ok: false };
  }
}

function eventSubControlResponse(
  headers: VerifiedEventSubHeaders,
  payload: unknown,
): Response | undefined {
  if (headers.messageType === "webhook_callback_verification") {
    const challenge = parseEventSubChallenge(payload);
    if (challenge === undefined) return new Response("Missing challenge", { status: 400 });
    return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (headers.messageType === "revocation") {
    logDiagnostic("warn", "twitch_eventsub_revoked", {
      subscriptionType: headers.subscriptionType ?? "unknown",
    });
    return new Response(null, { status: 204 });
  }
  if (
    headers.messageType !== "notification" ||
    headers.subscriptionType !== "channel.chat.message"
  ) {
    return new Response(null, { status: 204 });
  }
  return undefined;
}

function acceptedTwitchChatEvent(
  payload: unknown,
  broadcasterUserId: string,
): TwitchChatEvent | Response {
  const event = parseTwitchChatMessageEvent(payload);
  if (event === undefined) {
    return new Response("Invalid channel.chat.message payload", { status: 400 });
  }
  if (event.broadcasterUserId !== broadcasterUserId) {
    return new Response("Unexpected broadcaster", { status: 403 });
  }
  return event;
}

async function deliverTwitchReply(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  repository: D1MvpRepository;
  deliveryId: string;
  delivery: TwitchReplyDeliveryClaim;
}): Promise<void> {
  let messageId: string;
  try {
    messageId = await sendTwitchChatMessage(
      input.environment,
      {
        clientId: input.communityConfig.twitch.clientId,
        botUserId: input.communityConfig.twitch.botUserId,
      },
      {
        broadcasterId: input.communityConfig.twitch.broadcasterUserId,
        message: input.delivery.receipt.replyText,
        ...(input.delivery.receipt.replyToMessageId === undefined
          ? {}
          : { replyParentMessageId: input.delivery.receipt.replyToMessageId }),
      },
    );
  } catch (error) {
    const errorCode = error instanceof TwitchApiError ? error.code : "unexpected_error";
    if (error instanceof TwitchApiError) {
      await input.repository
        .markTwitchReplyFailed(input.deliveryId, input.delivery.sendToken, errorCode)
        .catch(() => {
          logDiagnostic("error", "twitch_reply_failure_state_failed", { errorCode });
        });
      logDiagnostic("error", "twitch_reply_failed", { errorCode });
    } else {
      await input.repository
        .markTwitchReplyAmbiguous(input.deliveryId, input.delivery.sendToken, errorCode)
        .catch(() => {
          logDiagnostic("error", "twitch_reply_ambiguous_state_failed", { errorCode });
        });
      logDiagnostic("error", "twitch_reply_ambiguous", { errorCode });
    }
    return;
  }
  try {
    await input.repository.markTwitchReplySent(
      input.deliveryId,
      input.delivery.sendToken,
      messageId,
    );
  } catch {
    logDiagnostic("error", "twitch_reply_ack_failed", { errorCode: "d1_ack_failed" });
  }
}

async function handleExistingTwitchReceipt(input: {
  deliveryId: string;
  receipt: TwitchReplyDeliveryClaim["receipt"];
  repository: D1MvpRepository;
  context: TrackedExecutionContext;
  communityConfig: CommunityConfig;
}): Promise<Response> {
  if (input.receipt.replyStatus === "sent" || input.receipt.sendClaimed) {
    return new Response(null, { status: 204 });
  }
  const delivery = await input.repository.claimTwitchReplyDelivery(input.deliveryId);
  if (delivery !== undefined) {
    input.context.waitUntilTask("twitch.reply_retry", async (backgroundEnvironment) => {
      await deliverTwitchReply({
        environment: backgroundEnvironment,
        communityConfig: input.communityConfig,
        repository: new D1MvpRepository(backgroundEnvironment.DB),
        deliveryId: input.deliveryId,
        delivery,
      });
    });
  }
  return new Response(null, { status: 204 });
}

async function buildClaimedTwitchCommandResult(input: {
  command: TwitchPublicCommand;
  chatterUserId: string;
  chatterUserLogin: string;
  deliveryId: string;
  observedAt: Date;
  repository: D1MvpRepository;
  communityConfig: CommunityConfig;
  claimToken: string;
}): Promise<{ replyText: string; boardChanged: boolean }> {
  try {
    return await buildTwitchPublicReply(
      input.command,
      input.chatterUserId,
      input.chatterUserLogin,
      input.deliveryId,
      input.observedAt,
      input.repository,
      input.communityConfig,
    );
  } catch (error) {
    if (error instanceof StableTwitchIdentityConflictError) {
      return {
        replyText: "I could not verify that Twitch login. Ask staff to check your link.",
        boardChanged: false,
      };
    }
    await input.repository.releaseTwitchCommand(input.deliveryId, input.claimToken);
    throw error;
  }
}

async function handleTwitchEventSub(
  request: Request,
  environment: CloudflareEnvironment,
  communityConfig: CommunityConfig,
  context: TrackedExecutionContext,
  replyToMessage = true,
): Promise<Response> {
  const rawBody = await request.text();
  const verification = await verifyTwitchEventSubRequest(
    request.headers,
    rawBody,
    requireEnvironmentValue(environment, "TWITCH_EVENTSUB_SECRET"),
    new Date(),
  );
  if (!verification.ok) {
    return new Response("Rejected EventSub delivery", {
      status: verification.reason === "missing_headers" ? 400 : 403,
    });
  }
  const parsedBody = parseJsonBody(rawBody);
  if (!parsedBody.ok) {
    return new Response("Invalid JSON", { status: 400 });
  }
  const controlResponse = eventSubControlResponse(verification.headers, parsedBody.payload);
  if (controlResponse !== undefined) return controlResponse;
  const acceptedEvent = acceptedTwitchChatEvent(
    parsedBody.payload,
    communityConfig.twitch.broadcasterUserId,
  );
  if (acceptedEvent instanceof Response) return acceptedEvent;
  const event = acceptedEvent;
  const command = parseTwitchPublicCommand(event.text);
  if (command === undefined) {
    return new Response(null, { status: 204 });
  }
  const observedAt = new Date(verification.headers.messageTimestamp);
  const repository = new D1MvpRepository(environment.DB);
  const commandClaim = await repository.claimTwitchCommand({
    deliveryId: verification.headers.messageId,
    eventType: `command:${command.name}`,
    receivedAt: observedAt,
    claimedAt: new Date(),
  });
  if (commandClaim.outcome === "processing") return new Response(null, { status: 204 });
  if (commandClaim.outcome === "ready") {
    return handleExistingTwitchReceipt({
      deliveryId: verification.headers.messageId,
      receipt: commandClaim.receipt,
      repository,
      context,
      communityConfig,
    });
  }
  const commandResult = await buildClaimedTwitchCommandResult({
    command,
    chatterUserId: event.chatterUserId,
    chatterUserLogin: event.chatterUserLogin,
    deliveryId: verification.headers.messageId,
    observedAt,
    repository,
    communityConfig,
    claimToken: commandClaim.claimToken,
  });
  await repository.completeTwitchCommand({
    deliveryId: verification.headers.messageId,
    claimToken: commandClaim.claimToken,
    replyText: commandResult.replyText,
    ...(replyToMessage ? { replyToMessageId: event.messageId } : {}),
  });
  context.waitUntilTask("twitch.receipt_cleanup", async (backgroundEnvironment) => {
    await new D1MvpRepository(backgroundEnvironment.DB).maintainExpiredReceipts(observedAt);
  });
  const delivery = await repository.claimTwitchReplyDelivery(verification.headers.messageId);
  if (delivery !== undefined) {
    context.waitUntilTask("twitch.reply_delivery", async (backgroundEnvironment) => {
      await deliverTwitchReply({
        environment: backgroundEnvironment,
        communityConfig,
        repository: new D1MvpRepository(backgroundEnvironment.DB),
        deliveryId: verification.headers.messageId,
        delivery,
      });
    });
  }
  if (commandResult.boardChanged) {
    context.waitUntilTask("twitch.board_drain", async (backgroundEnvironment) => {
      await synchronizeCanonicalBoard({
        environment: backgroundEnvironment,
        communityConfig,
        changedAt: observedAt,
        createIfMissing: false,
        context,
      });
    });
  }
  return new Response(null, { status: 204 });
}

function hasDiagnosticsAccess(request: Request, environment: CloudflareEnvironment): boolean {
  const expected = `Bearer ${requireEnvironmentValue(environment, "SPIKE_DIAGNOSTICS_TOKEN")}`;
  const actual = request.headers.get("Authorization") ?? "";
  if (expected.length !== actual.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= (expected.codePointAt(index) ?? 0) ^ (actual.codePointAt(index) ?? 0);
  }
  return mismatch === 0;
}

type WorkerRoute = "health" | "twitch" | "discord" | "status" | "legacy_repair";

function workerRoute(request: Request, url: URL): WorkerRoute | undefined {
  if (request.method === "GET" && url.pathname === "/health") return "health";
  if (request.method === "POST" && url.pathname === "/webhooks/twitch/eventsub") return "twitch";
  if (request.method === "POST" && url.pathname === "/webhooks/discord/interactions") {
    return "discord";
  }
  if (request.method === "GET" && url.pathname === "/internal/status") return "status";
  if (request.method === "POST" && url.pathname === "/internal/repair-unassigned-requests") {
    return "legacy_repair";
  }
  return undefined;
}

async function handleLegacyRepair(
  environment: CloudflareEnvironment,
  communityConfig: CommunityConfig,
  context: TrackedExecutionContext,
): Promise<Response> {
  const repository = new D1MvpRepository(environment.DB);
  const result = await repository.repairLegacyUnassignedRequests({
    recipientLimit: communityConfig.policies.recipientLimit,
    changedAt: new Date(),
  });
  if (result.repaired > 0 && !result.hasMore) {
    await synchronizeCanonicalBoard({
      environment,
      communityConfig,
      changedAt: new Date(),
      createIfMissing: false,
      context,
    });
  }
  return Response.json(result);
}

async function handleInternalStatus(
  environment: CloudflareEnvironment,
  communityConfig: CommunityConfig,
): Promise<Response> {
  const [authorization, database] = await Promise.all([
    validateTwitchAuthorization(environment, {
      clientId: communityConfig.twitch.clientId,
      botUserId: communityConfig.twitch.botUserId,
    }),
    new D1MvpRepository(environment.DB).getDiagnostics(),
  ]);
  const recovery = getTwitchAuthorizationRecovery(authorization);
  return Response.json({
    authorization,
    database,
    ...(recovery === undefined ? {} : { recovery }),
  });
}

async function handleConfiguredWorkerRequest(input: {
  route: Exclude<WorkerRoute, "health">;
  request: Request;
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  context: TrackedExecutionContext;
}): Promise<Response> {
  if (input.route === "twitch") {
    return handleTwitchEventSub(
      input.request,
      input.environment,
      input.communityConfig,
      input.context,
    );
  }
  if (input.route === "discord") {
    return handleDiscordInteraction(
      input.request,
      input.environment,
      input.communityConfig,
      input.context,
    );
  }
  if (!hasDiagnosticsAccess(input.request, input.environment)) {
    return new Response("Not found", { status: 404 });
  }
  return input.route === "legacy_repair"
    ? handleLegacyRepair(input.environment, input.communityConfig, input.context)
    : handleInternalStatus(input.environment, input.communityConfig);
}

async function handleWorkerRequest(input: {
  request: Request;
  environment: CloudflareEnvironment;
  context: TrackedExecutionContext;
  communityConfigOverride?: CommunityConfig;
}): Promise<Response> {
  const communityConfig =
    input.communityConfigOverride ?? communityConfigFromEnvironment(input.environment);
  const configurationErrors = validateCommunityConfig(communityConfig);
  const route = workerRoute(input.request, new URL(input.request.url));
  if (route === "health") {
    return Response.json({
      status: "ok",
      environment: input.environment.APP_ENV,
      configuration: configurationErrors.length === 0 ? "ready" : "incomplete",
    });
  }
  if (route === undefined) return new Response("Not found", { status: 404 });
  if (configurationErrors.length > 0) {
    return new Response("Community configuration is incomplete", { status: 503 });
  }
  return handleConfiguredWorkerRequest({
    route,
    request: input.request,
    environment: input.environment,
    communityConfig,
    context: input.context,
  });
}

export function createWorker(communityConfigOverride?: CommunityConfig) {
  return {
    async fetch(
      request: Request,
      environment: CloudflareEnvironment,
      context: ExecutionContext,
    ): Promise<Response> {
      return observeWorkerRequest(request, environment, context, async (measured, tracked) => {
        return handleWorkerRequest({
          request,
          environment: measured,
          context: tracked,
          ...(communityConfigOverride === undefined ? {} : { communityConfigOverride }),
        });
      });
    },
  } satisfies ExportedHandler<CloudflareEnvironment>;
}

export default createWorker();

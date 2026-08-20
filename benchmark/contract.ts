export const BENCHMARK_SCALES = [100, 1_000, 10_000, 100_000] as const;
export const BENCHMARK_WARMUPS = 3;
export const BENCHMARK_SAMPLES = 10;
export const QUEUE_PERCENTILES = [10, 50, 90] as const;

export const USER_OPERATION_IDS = [
  "discord.request.form.prefilled",
  "discord.request.submit.created",
  "discord.request.submit.already-active",
  "discord.queue.p10",
  "discord.queue.p50",
  "discord.queue.p90",
  "discord.link.self",
  "twitch.request.created",
  "twitch.request.already-active",
  "twitch.queue.p10",
  "twitch.queue.p50",
  "twitch.queue.p90",
  "discord.board.create",
  "discord.board.open",
  "discord.board.refresh",
  "discord.raid.review",
  "discord.raid.review.cancel",
  "discord.raid.call-start.streamer",
  "discord.raid.result.helped",
  "discord.requester.postpone.remaining",
  "discord.requester.postpone.last",
  "discord.requester.remove.remaining",
  "discord.requester.remove.last",
  "discord.requester.pull.candidates",
  "discord.requester.pull.with-push",
] as const;

export type UserOperationId = (typeof USER_OPERATION_IDS)[number];

export const BENCHMARK_OPERATION_FAMILIES = [
  "discord:request",
  "discord:queue",
  "discord:link-twitch",
  "twitch:request",
  "twitch:queue",
  "board:create",
  "board:open",
  "board:refresh",
  "raid:review",
  "raid:cancel-review",
  "raid:call-start",
  "raid:result",
  "raid:postpone-requester",
  "raid:remove-requester",
  "raid:pull-requester",
] as const;

export type BenchmarkOperationFamily = (typeof BENCHMARK_OPERATION_FAMILIES)[number];

export const OPERATION_FAMILY_BY_ID: Readonly<Record<UserOperationId, BenchmarkOperationFamily>> = {
  "discord.request.form.prefilled": "discord:request",
  "discord.request.submit.created": "discord:request",
  "discord.request.submit.already-active": "discord:request",
  "discord.queue.p10": "discord:queue",
  "discord.queue.p50": "discord:queue",
  "discord.queue.p90": "discord:queue",
  "discord.link.self": "discord:link-twitch",
  "twitch.request.created": "twitch:request",
  "twitch.request.already-active": "twitch:request",
  "twitch.queue.p10": "twitch:queue",
  "twitch.queue.p50": "twitch:queue",
  "twitch.queue.p90": "twitch:queue",
  "discord.board.create": "board:create",
  "discord.board.open": "board:open",
  "discord.board.refresh": "board:refresh",
  "discord.raid.review": "raid:review",
  "discord.raid.review.cancel": "raid:cancel-review",
  "discord.raid.call-start.streamer": "raid:call-start",
  "discord.raid.result.helped": "raid:result",
  "discord.requester.postpone.remaining": "raid:postpone-requester",
  "discord.requester.postpone.last": "raid:postpone-requester",
  "discord.requester.remove.remaining": "raid:remove-requester",
  "discord.requester.remove.last": "raid:remove-requester",
  "discord.requester.pull.candidates": "raid:pull-requester",
  "discord.requester.pull.with-push": "raid:pull-requester",
};

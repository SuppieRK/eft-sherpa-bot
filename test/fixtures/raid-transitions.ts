import type { StaffBoardRaid } from "../../src/domain/staff-board";
import type { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

async function storedRaid(repo: D1MvpRepository, id: number): Promise<StaffBoardRaid> {
  const raid = await repo.getRaid(id);
  if (raid === undefined) throw new Error("The test raid was not found.");
  return raid;
}

export async function completedRaid(
  repo: D1MvpRepository,
  input: Parameters<D1MvpRepository["completeRaid"]>[0],
) {
  await repo.completeRaid(input);
  return storedRaid(repo, input.groupId);
}

export async function postponedRaid(
  repo: D1MvpRepository,
  input: Parameters<D1MvpRepository["postponeRaid"]>[0],
) {
  await repo.postponeRaid(input);
  return storedRaid(repo, input.groupId);
}

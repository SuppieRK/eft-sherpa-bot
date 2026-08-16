const twitchLoginPattern = /^[a-z0-9_]{1,25}$/;

export function normalizeTwitchLogin(value: string): string | undefined {
  const normalized = value.trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
  return twitchLoginPattern.test(normalized) ? normalized : undefined;
}

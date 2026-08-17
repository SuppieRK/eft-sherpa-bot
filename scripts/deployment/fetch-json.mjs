function responseSummary(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 160) || "empty response";
}

export async function checkedJson(url, init, fetcher = fetch) {
  const response = await fetcher(url, init);
  const body = await response.text();
  const path = new URL(url).pathname;
  const contentType = response.headers.get("content-type") ?? "unknown content type";

  if (!response.ok) {
    throw new Error(
      `${path} failed with status ${response.status} and ${contentType}: ${responseSummary(body)}`,
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      `${path} returned non-JSON content with status ${response.status} and ${contentType}: ${responseSummary(body)}`,
    );
  }
}

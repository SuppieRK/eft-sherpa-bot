## 1. Board rendering

- [x] 1.1 Replace the canonical board raid occupancy fraction with a Markdown-safe `Requesters:` line containing every current Twitch login.
- [x] 1.2 Preserve the existing mode, map, state, attempt, leader, detail-link, selector, and disabled-mention behavior without adding D1 reads.

## 2. Regression coverage

- [x] 2.1 Update staff-board unit coverage for a single requester and assert that the misleading party-occupancy fraction is absent.
- [x] 2.2 Add grouped-requester and maximum-board-shape coverage proving every Twitch login is shown and the aggregate embed remains within Discord's limit.

## 3. Verification and DEV delivery

- [x] 3.1 Run formatting, lint, type checking, tests, and strict OpenSpec validation.
- [x] 3.2 Commit and push the verified change on the current branch.
- [x] 3.3 Deploy the committed revision to the existing DEV Worker with variables preserved and verify live health and authenticated diagnostics.

## 1. Receipt lifecycle

- [x] 1.1 Add regression cases for completion-write failure through all four Discord action paths.
- [x] 1.2 Add the shared receipt module and move the four callers to it without changing SQL.
- [x] 1.3 Test duplicate delivery, action failure, claim expiry, domain rejection, and tracked cleanup failure.

## 2. Query cleanup

- [x] 2.1 Remove both forwarding classes and use the existing query methods directly.

## 3. Verification

- [x] 3.1 Run the full test suite, static checks, build, and OpenSpec validation.
- [x] 3.2 Run the fully local D1 benchmark, compare exact counters, and record results without increasing maximum budgets.

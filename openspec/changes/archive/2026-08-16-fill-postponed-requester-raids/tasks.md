## 1. Repository behavior

- [x] 1.1 Make requester-postponement follow-ups automatically fillable while keeping whole-raid postponements isolated
- [x] 1.2 Reuse a compatible follow-up for repeated requester postponements and allocate new follow-ups after the existing chain
- [x] 1.3 Keep requester transfer and destination validation atomic under D1 failures and capacity races

## 2. Regression coverage

- [x] 2.1 Cover the only-requester then later same-map request flow
- [x] 2.2 Cover multiple requesters postponed from one source, queue separation, and full map-specific capacity
- [x] 2.3 Cover atomic rollback and unchanged whole-raid isolation

## 3. Verification and delivery

- [x] 3.1 Run OpenSpec validation and the complete project verification suite
- [x] 3.2 Run the fully local D1 benchmark through 100,000 rows and update its reports
- [x] 3.3 Deploy the pilot Worker without a data reset or Discord command registration
- [x] 3.4 Clear disposable pilot application data and sequences while preserving the canonical Discord board record and baseline schema
- [x] 3.5 Verify empty remote state, preserved board identity, unchanged migration history, and live health
- [x] 3.6 Complete the clean-state Discord requester-postponement scenario

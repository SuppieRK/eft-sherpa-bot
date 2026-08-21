# Local Worker CPU Profile

## Test Workload

The test used local workerd. It sent 500 signed Twitch requests and 500 signed Discord requests. It did not use real credentials or a remote D1 database.

The before and after profiles used the same replay command and the same profiler sample interval.

## Result

| Profile | Import-key self-hit samples | Total self-hit samples | Profile window |
|---|---:|---:|---:|
| Before key cache | 55 | 1,187 | 15.270 seconds |
| After key cache | 7 | 1,108 | 15.596 seconds |

The imported-key cache reduced the samples in `crypto.subtle.importKey` from 55 to 7. This is an 87% reduction for that function in this workload. The total self-hit sample count decreased by 6.7%.

These values are local profile evidence. They are not production latency limits. The generated CPU profiles and temporary signing values stay under `.artifacts/worker-profile` and are not committed.

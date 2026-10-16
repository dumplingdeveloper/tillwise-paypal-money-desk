# MCP conformance

`scripts/conformance.sh` runs the official
[MCP conformance suite](https://github.com/modelcontextprotocol/conformance)
(`@modelcontextprotocol/conformance@0.1.16`, `--spec-version 2025-11-25`) against a
short-lived loopback instance of `mcp-server`, then compares the result with
[`baseline.yml`](baseline.yml).

```bash
./scripts/conformance.sh        # needs the WordPress stack from docker compose for WP_* settings
```

Exit codes:
- 0: only the failures listed in the baseline.
- 1: a new failure, or a baseline entry that now passes (the baseline is stale).

## Result (measured 2026-09-29)

Total: 9 scenarios passed, 22 failed. All 22 failures are in the baseline.

| Scenario | Result | Notes |
|---|---|---|
| server-initialize | pass | |
| ping | pass | |
| tools-list | pass | |
| resources-list | pass | Lists the two Agent Skills as `skill://` resources |
| server-sse-multiple-streams | pass | 3 concurrent POSTs accepted; the server answers with JSON (`enableJsonResponse`) |
| dns-rebinding-protection | pass (2 checks) | Host/Origin allow-list |
| tools-call-simple-text, tools-call-error | pass, but not counted | They also pass when the fixture tool does not exist ([#515](https://github.com/modelcontextprotocol/conformance/issues/515), fix proposed in [#165](https://github.com/modelcontextprotocol/conformance/pull/165)) |
| 10 scenarios for prompts, completions, logging and resource subscriptions | fail (expected) | The server does not declare these capabilities and answers `-32601 Method not found` ([#516](https://github.com/modelcontextprotocol/conformance/issues/516)) |
| 5 scenarios for sampling, elicitation and progress | fail (expected) | They call the suite's own fixture tools, which this server does not have |
| 7 scenarios for image/audio/embedded content and `test://` resources | fail (expected) | Fixture tools and resources from the suite's reference server |

Found while running it: the CLI `--help` for 0.1.16 on npm has no `--requirements`
option, although the README on the repository's `main` branch documents one.

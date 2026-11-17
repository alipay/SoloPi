# solopi-lab

Independent companion for solopi-desktop: one coordinator and one node per laboratory computer. No LLM loop, no built-in business/package rules. Platform adapters are independently installed outside this package.

Architecture and acceptance contract: [方案](../../docs/architecture/solopi-lab.md). This is the first local implementation, not a deployed fleet or a proven 4–10-device capacity claim.

## Install and run

Python 3.9+ is required, with no runtime third-party dependencies. Install in a dedicated environment:

```sh
python3 -m venv /opt/solopi-lab/venv
/opt/solopi-lab/venv/bin/python -m pip install /path/to/GlassesBox/integrations/solopi-lab
```

The package contains no platform-specific adapters. Configure an independently installed HTTPS receiver or an absolute command path in `targets`. The operator supplies the receiver credential through `tokenEnv`; use `requiredSourceFields` and `sourceEquals` for generic target scope constraints. The example receiver domain is a placeholder and must be replaced before use.

Copy and edit `examples/*.json`. Provide distinct randomly generated tokens of at least 24 characters through named environment variables or protected token files, never in request JSON. Each node credential is bound to a single `nodeId`. Paths and argv are operator-configured, not model-supplied. Configuration examples are placeholders and cannot be used as real device mappings.

```sh
solopi-lab --config coordinator.json group-set --root ./co-state --file group.json
solopi-lab --config coordinator.json coordinator --root ./co-state
solopi-lab --config node.json node --root ./node-state
solopi-lab --config client.json call submit --file request.json
solopi-lab --config client.json call list
```

Remote URLs and listeners require TLS. For local development use `http://127.0.0.1:8765`. A coordinator behind a TLS reverse proxy can keep its default loopback listener; direct external binding requires `tlsCert` and `tlsKey` in its config. Certificate validation is never disabled. Example systemd units are templates, not automatically installed/enabled by this change. Use persistent state directories and the same executor user/data directory that owns SoloPi tasks. No automatic migration from `lab-agent` occurs.

`capacity` controls how many assigned device groups a node may handle. Start at 2 and validate real CPU/media/ADB capacity before increasing. Same physical serial cannot be configured into two groups, even across nodes. A submitted task runs cases in their original order; automatic case sharding is not implemented.

## One contract, three interfaces

Operations: `health`, `resources`, `submit`, `status`, `list`, `stop`, `artifacts`. Inspect their exact JSON schemas in `solopi_lab/core.py:OPERATIONS` or MCP `tools/list`. All CLI calls return JSON; failures have nonzero exit status and `code`.

- HTTP: authenticated `POST /v1/<operation>` with a JSON object. `Authorization: Bearer ...` is required even for health.
- CLI: `solopi-lab --config client.json call <operation> --file arguments.json` calls the same HTTP implementation.
- MCP: `solopi-lab --config client.json mcp` serves newline-delimited stdio JSON-RPC (baseline MCP protocol `2024-11-05`) with the same operations as `lab_<operation>`. Configure the executable/argv and credential environment in your MCP host. Streamable HTTP MCP is not implemented.

Submission needs stable `requestId` plus explicit `caseIds`. Retrying an identical logical request returns the same laboratory job; a changed body with the same ID is rejected. An occupied pool queues requests. `requirements` uses exact matches against group attributes, `nodeId` or `groupId`. Do not generate a new request ID merely because the response was lost.

Lab `jobId` and SoloPi `taskId` are distinct, explicitly mapped. The executor is the original `tools call submit_task` CLI, with leased device bindings; `tasks show` and `tasks stop` use the original ID and original formal task visibility. No shadow test execution or report import is created. `options` passes declared start/performance/stress options; the installed executor is still authoritative for validation and runtime support.

For status, stop and artifacts create an arguments file containing `{"jobId":"<returned-lab-job-id>"}`. Status is scoped to the credential owner; admin credentials may inspect all jobs. `list` returns `nextAfter` for paging. Application adapters must enforce actual human identities and permission scopes before using their service credentials; a user ID in `source` is not authorization.

## Stop, recovery and unknown results

Coordinator/node processes hold OS advisory singleton locks per state directory. The coordinator stores queues, leases, report snapshots, artifacts and deliveries in SQLite. Nodes store submission intent **before** the CLI side effect. A node can restore known task IDs after restart; a lost submission/claim result becomes `needs_reconciliation`, not an automatic rerun. Heartbeat expiration disables new dispatch but does not release existing leases.

`stop` cancels queued work or records `stop_requested`; running work is released only after the node observes the original terminal report. A node with a durable never-submitted record can cancel without touching a device. An explicit executor `submitted:false` refusal is recorded as a submission failure and releases the group; an ambiguous error does not. Node shutdown makes bounded stop attempts for its known tasks; uncertainty remains visible and owned. Stopping the coordinator alone does not stop independent executors.

For an unknown submission, stop the affected node service, inspect the real executor history, and attach only a verified original task:

```sh
solopi-lab --config node.json node-reconcile --root ./node-state --job-id JOB --task-id TASK --reason 'Verified original submission in executor report'
```

The reconciliation command verifies case IDs and leased device serials before attaching; it never submits a replacement. If no task can be proven, keep the lease quarantined and preserve evidence rather than editing SQLite or releasing on elapsed time. Releasing a proven never-submitted unknown job without a task requires an operator recovery enhancement; first version intentionally has no unsafe force-release shortcut.

## Artifacts and delivery

Nodes upload files referenced by authoritative per-case `artifacts` and the report package, only beneath configured `artifactRoots` after resolving symlinks. Directories are not uploaded. Include every legitimate executor report/log root in the config. Coordinator uploads are streamed, authenticated and size-limited (default 512 MiB per file). Remote authenticated downloads use returned `downloadPath`; CLI `download PATH --output FILE` refuses to overwrite existing files.

The compact report retains original identity, status, case membership and artifact references, not duplicated prompts/model context. Full original report is available through its report package when produced and successfully uploaded. Completion frees devices independently of artifact transfer; status exposes `artifactState` and `artifactErrors`. Failed file transfer retries are journaled/bounded (default 5), without re-executing tests. No automatic artifact retention/deletion policy is enabled yet: provision disk monitoring and capacity before production use.

Result targets are configured by the operator; credentials allow named targets. HTTP targets receive HMAC-SHA256 signed JSON (`X-Lab-Signature`, `X-Lab-Event-Id`); command targets receive a private event file through fixed argv with `{{eventFile}}`. There is no caller-provided arbitrary webhook URL or shell command. Terminal event IDs remain stable through retries. Delivery is at-least-once and receivers must deduplicate; successful POST response loss is not proof of failure. Five failed attempts settle as `failed` separately from the business result. Platform-specific translation, authentication and result delivery belong to private external adapters, not this package.

## Isolated checks

```sh
PYTHONPATH=integrations/solopi-lab python3 -m unittest discover -s integrations/solopi-lab/tests -v
```

Run from repository root. Tests use temporary SQLite stores, loopback HTTP and fake executor commands, never real devices or a logged-in platform. A passing local test does not prove live Linux media throughput, office app permissions, fleet high availability, package installation or real business success. Do not run new and old adapters against the same groups during migration.

## Deployment boundary

Version 0.1.0 does not replace the old adapter's external registration/package-install workflow. Those preparations remain in independent adapters; migrating an existing pipeline requires an explicit equivalent-preparation acceptance before switching its device groups. This implementation has not enabled real office bots or a production coordinator. Configure the built-in Agent as an MCP client, or use the same JSON CLI from external agents; there is no separate model-driven lab executor.

## Agent entry configuration

The reusable task-management instructions are in [agent-instructions.md](agent-instructions.md); bind the [solopi-lab-task-ops Skill](../../skills/solopi-lab-task-ops/SKILL.md) for exact request/response and recovery contracts. These change agent behavior, not service deployment. Verify the host executable implements the new `call`/`mcp` contract: a same-named older SoloPi desktop CLI is not the laboratory client. New tasks require a real configured coordinator; old lab-agent task IDs stay in their original ledger for read-only follow-up.

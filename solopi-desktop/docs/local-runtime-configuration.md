# Local CLI runtimes

Codex and Claude Code are built in. Additional installed CLIs use the same protocol adapters through configuration; the application does not install or log into them.

Add `localRuntimes` to a trusted team configuration and import it through Settings → Team configuration, or:

```sh
solopi-desktop config import-team --file team.json --json
```

```json
{
  "schemaVersion": "lenswiper.team-config.v1",
  "id": "my-team",
  "name": "My team",
  "version": "1",
  "localRuntimes": [{
    "id": "my-cli",
    "name": "My CLI",
    "command": "my-cli",
    "args": ["--model-only"],
    "family": "claude",
    "modelsCommand": {
      "command": "node",
      "args": ["/path/to/private/model-catalog.cjs"]
    }
  }]
}
```

`family` is `codex` (app-server JSON-RPC) or `claude` (structured print output). `command` can be an executable name found on the host PATH or an absolute path. Each argument is passed separately without shell interpolation. CLI protocol compatibility is required; an arbitrary shell command cannot serve as a model runtime.

`modelsCommand` is optional. When the user opens or refreshes the model picker, it receives `{"runtimeId":"my-cli"}` on stdin and must write one JSON document to stdout:

```json
{"items":[{"id":"model-id","name":"Model label","isDefault":true}]}
```

The command has a 20-second timeout. Failures remain errors, while a successful empty `items` list permits manual model entry. Only model ID, label, and default status reach the picker. Without a catalog command, Codex uses its protocol model list and Claude reads locally configured model IDs.

Only import trusted configurations: imported commands execute on that computer when the runtime or model catalog is used. Import itself stores definitions without executing them. Keep credentials in the CLI's own protected login storage; do not put them in arguments. Custom catalogs and enterprise configuration are managed outside the public source and must be installed on each target host.

Definitions are stored in `runtime-definitions.json` under the application's data directory. `SOLOPI_RUNTIME_CONFIG` can explicitly select an absolute configuration file for standalone transport use; an explicitly supplied host data directory takes precedence. Team JSON is an import/export snapshot and is not watched for changes. Importing definitions preserves the current model selection and unrelated settings; select the runtime separately in Settings → Model configuration.

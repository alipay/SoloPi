# Build and deploy your own Lab Server

The public source includes Desktop, Lab Server, the Web UI, versioned API schemas,
database migrations, three public Skills and the optional Python coordinator.
It contains no existing database, devices, accounts, model keys, private tools or
deployment configuration. Each deployment creates its own data and credentials.

## Requirements and build

Use Node.js 24 or newer and npm. Run commands from the exported source root and
preserve its directory layout: Web and Server reuse Desktop source files.
All npm packages resolve through the public npm registry.

```sh
npm --prefix solopi-desktop ci --ignore-scripts --registry=https://registry.npmjs.org
npm --prefix solopi-lab-server ci --ignore-scripts --registry=https://registry.npmjs.org
npm --prefix solopi-lab-server/web ci --ignore-scripts --registry=https://registry.npmjs.org
npm --prefix solopi-desktop run build
npm --prefix solopi-lab-server/web run build
npm --prefix solopi-lab-server run verify:public-usage
```

The Web build includes the shared Desktop report viewer. Database migrations run
locally on first startup; there is no database server to import or download.
These API/Web build commands skip install hooks and do not download the Electron
desktop runtime. Running or packaging Desktop separately requires preparing its
Electron and native runtimes; this is not needed to host the Server and Web UI.

## Create your own deployment

Choose a new directory. Initialization refuses an existing directory and reuses
the Server's native migrations and admin bootstrap. It saves a generated token in
`admin.token` and the new scope IDs in `scope.json`, and prints paths and expiry
only. Do not commit or publish this directory.

```sh
node solopi-lab-server/scripts/init.mjs --data-dir ./solopi-lab-server/data --org my-lab --project default
```

### API Server

```sh
node solopi-lab-server/src/serve.mjs --db ./solopi-lab-server/data/lab.db --host 127.0.0.1 --port 8781
```

`GET /v1/healthz` reports availability. Project APIs require the generated Bearer
token and scope IDs. The [public HTTP contract](PUBLIC_USAGE.md) and public
`solopi-lab-task-ops` Skill describe discovery, submission, progress and reports.

### Web and Server Superagent

The included Web gateway reuses the same database and native Server components:

```sh
node solopi-lab-server/deploy/stage-a/httpview.mjs --db ./solopi-lab-server/data/lab.db --token-file ./solopi-lab-server/data/admin.token --map-file ./solopi-lab-server/data/scope.json --host 127.0.0.1 --port 8780
```

Open `http://127.0.0.1:8780`. It starts without a model key or an enterprise
extension; configure your own model in its runtime settings before asking the
Superagent to reason. Connect your own Desktop clients and devices to execute
tests; an empty catalog is expected on a fresh deployment. The API Server and
gateway are separate entry points; use the gateway `/cp/*` registration address
when connecting a Desktop through the Web deployment.

The Web gateway is intended for a trusted local/private lab and has no user login.
Keep it behind your own authenticated access layer if reachable by untrusted
users. For a reverse proxy, set `SOLOPI_UA_TRUSTED_ORIGINS` to your actual Web
origin(s). Origin checks do not provide user authentication. The generated admin
credential has an expiry; use the existing `admincli.mjs admin grant` / revoke
workflow to manage its lifecycle. No credential from another deployment is needed.

Context search optionally connects to a separately configured search service.
Its absence does not prevent basic startup; configure it to use that capability.
Media preview uses the included `solopi-lab-server/src/media-view.mjs` data-plane
process and a configured trusted URL; tests can run without opening media views.

## Optional independent coordinator

The Node Server's `/v1/lab/*` APIs do not require the Python coordinator. If you
choose the independent `solopi-lab` coordinator instead, install its public source
with Python 3.9+:

```sh
python3 -m pip install ./solopi-lab-server/integrations/solopi-lab
solopi-lab --help
```

Use its [configuration and launch guide](../../solopi-lab-server/integrations/solopi-lab/README.md).
Its job IDs and endpoints belong to a separate service; do not mix them with the
Node Server task ledger. Private package sources and business integrations remain
optional deployment extensions.

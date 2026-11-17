# SoloPi Lab Server

The Server hosts client registration, device/group scheduling, test task records and the Server Superagent. It uses the same native Desktop contracts and shared runtime. The Web UI is built from `web/`; API contracts and database migrations are in `contracts/` and `migrations/`.

See [self-hosting](docs/SELF_HOSTING.md) for installation, initialization and startup, and [public API usage](docs/PUBLIC_USAGE.md) for integration. Node.js 24 LTS is required. Desktop and Server must remain sibling directories for shared source builds.

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run sync:desktop
npm run prestart
```

Runtime databases, model credentials, token files and generated Web links belong to local deployment state and are excluded from Git. Enterprise integrations and business Skills are external deployment extensions.

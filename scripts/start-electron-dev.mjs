import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const dataDirArg = process.argv.indexOf('--data-dir');
const isolatedDataDir = dataDirArg >= 0 ? path.resolve(process.argv[dataDirArg + 1] || '') : '';
const inspectPort=process.env.LENSWIPER_DEV_INSPECT_PORT;
if(inspectPort && (!/^\d+$/.test(inspectPort) || Number(inspectPort)<1024 || Number(inspectPort)>65535))throw new Error('Invalid development inspector port');
if (isolatedDataDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(isolatedDataDir, 'dev-workspace.json'), 'utf8'));
  if (manifest.schemaVersion !== 'lenswiper.dev-workspace.v1' || fs.realpathSync(isolatedDataDir) === fs.realpathSync(manifest.sourceDataDir)) throw new Error('Invalid isolated development workspace');
}


let shuttingDown = false;
let electronProcess;
let webpackProcess;
let rendererUrl;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, "127.0.0.1");
  });
}

async function getAvailablePort(startPort = 5173) {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available renderer port found from ${startPort} to ${startPort + 49}`);
}

function canReachRenderer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });

    req.on("error", () => {
      resolve(false);
    });

    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForRenderer() {
  return new Promise((resolve) => {
    const check = async () => {
      if (await canReachRenderer(rendererUrl)) {
        resolve();
        return;
      }

      setTimeout(check, 250);
    };

    void check();
  });
}

function startWebpack(port) {
  webpackProcess = spawn(
    isWindows ? "npx.cmd" : "npx",
    ["webpack", "serve", "--mode", "development", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    }
  );

  webpackProcess.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      process.exit(code ?? 1);
    }
  });
}

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  electronProcess?.kill();
  webpackProcess?.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const rendererPort = await getAvailablePort();
rendererUrl = `http://127.0.0.1:${rendererPort}`;
startWebpack(rendererPort);

await waitForRenderer();

electronProcess = spawn(
  isWindows ? "npx.cmd" : "npx",
  ["electron", ...(inspectPort?[`--inspect=127.0.0.1:${inspectPort}`]:[]), "electron/main.js", ...(isolatedDataDir ? ["--glassbox-cli-data-dir", isolatedDataDir] : [])],
  {
    cwd: root,
    env: {
      ...process.env,
      ...(isolatedDataDir ? { LENSWIPER_TASK_UI_DATA_DIR: JSON.parse(fs.readFileSync(path.join(isolatedDataDir, "dev-workspace.json"), "utf8")).sourceDataDir } : {}),
      NODE_ENV: "development",
      ELECTRON_RENDERER_URL: rendererUrl,
    },
    stdio: "inherit",
  }
);

electronProcess.on("exit", () => {
  shutdown();
});

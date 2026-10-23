#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const host = process.env.GLASSBOX_LOCAL_TTS_HOST || '127.0.0.1';
const port = Number(process.env.GLASSBOX_LOCAL_TTS_PORT || 17322);
const dataDir = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Glass Box')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Glass Box')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Glass Box');
const audioDir = path.join(dataDir, 'local-tts-server');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function synthesize(text) {
  const finalText = String(text || '').trim();
  if (!finalText) {
    throw new Error('missing text');
  }

  fs.mkdirSync(audioDir, { recursive: true });
  const hash = crypto.createHash('sha1').update(`${finalText}:${Date.now()}`).digest('hex').slice(0, 12);
  const aiffPath = path.join(audioDir, `${hash}.aiff`);
  const wavPath = path.join(audioDir, `${hash}.wav`);

  await run('/usr/bin/say', ['-o', aiffPath, finalText]);
  await run('/opt/homebrew/bin/ffmpeg', [
    '-y',
    '-i',
    aiffPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-sample_fmt',
    's16',
    wavPath,
  ]);
  fs.rmSync(aiffPath, { force: true });

  return {
    fileName: path.basename(wavPath),
    url: `http://${host}:${port}/audio/${path.basename(wavPath)}`,
    path: wavPath,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/synthesize') {
      const body = await readJsonBody(request);
      const result = await synthesize(body.text);
      writeJson(response, 200, {
        success: true,
        data: {
          url: result.url,
          path: result.path,
        },
      });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/audio/')) {
      const fileName = path.basename(decodeURIComponent(url.pathname.slice('/audio/'.length)));
      const filePath = path.join(audioDir, fileName);
      if (!fs.existsSync(filePath)) {
        writeJson(response, 404, { success: false, error: 'audio not found' });
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(response);
      return;
    }

    writeJson(response, 404, { success: false, error: 'not found' });
  } catch (error) {
    writeJson(response, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`GlassBox local TTS server listening on http://${host}:${port}`);
});

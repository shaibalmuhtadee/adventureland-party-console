import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { redirectInternal, fromGateway, dashboardReadyMessage } from './gateway-access.ts';
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { fingerprint } from "./fingerprint.ts";
import { completed, launch, stop, waitForHealthy } from "./process.ts";
import { readJson, withBuildLock } from '../build-store.ts';
import { dashboardHistory, rememberDashboard, releasePath, cleanDashboard, pinDashboard } from './history.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dashboard");
const vinext = path.join(root, "node_modules/vinext/dist/cli.js");
const publicPort =
  Number(
    process.argv.find((argument) => argument.startsWith("--port="))?.split("=")[1] ||
      process.env.AL_DASHBOARD_PUBLIC_PORT,
  ) || 3010;
const stateFile = path.join(
  root,
  process.env.AL_DASHBOARD_MODE_FILE || (publicPort === 3010 ? ".build/mode.json" : `.build/mode-${publicPort}.json`),
);
type Mode = "development" | "production";
type Running = { mode: Mode; port: number; process: ChildProcess; generation?: string; id: string };
let active: Running | undefined;
let previous: Running | undefined;
let pending: ChildProcess | undefined;
let busy = false;
let failure: string | null = null;
let nextPort = publicPort + 1;
let rollbackSelection: string | undefined;
async function pin(extra?: string) {
  if (process.env.AL_DASHBOARD_PREBUILT) return;
  await pinDashboard(root, publicPort, [active?.generation, previous?.generation, extra].filter((id): id is string => !!id));
}

async function cleanup(apply: boolean) {
  return withBuildLock(path.join(root, '.build'), () => cleanDashboard(root,
    [active?.generation, previous?.generation].filter((id): id is string => !!id), apply));
}

async function productionBuild(): Promise<string> {
  if (process.env.AL_DASHBOARD_PREBUILT) {
    const output = path.resolve(root, process.env.AL_DASHBOARD_PREBUILT);
    await readFile(path.join(output, "server/index.js"));
    return output;
  }
  // Dashboard components import maintained runtime helpers outside their root.
  // Include those sources and the build pipeline so shared fixes cannot reuse
  // a completed release containing the previous implementation.
  const generation = await fingerprint(root, ['../runtime', '../tools/dashboard']);
  await pin(generation);
  const output = path.join(root, ".build/releases", generation);
  try {
    await readFile(path.join(output, "complete.json"));
    return output;
  } catch {
    /* Build cache miss. */
  }
  pending = launch(path.resolve(root, "../tools/dashboard/build.mts"), [], root, {
    ...process.env,
    AL_DASHBOARD_OUT_DIR: output,
  });
  await completed(pending);
  pending = undefined;
  await readFile(path.join(output, "server/index.js"));
  await writeFile(path.join(output, "complete.json"), JSON.stringify({ generation }));
  return output;
}

async function saveMode(mode: Mode): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile + ".tmp", JSON.stringify({ mode, rollback: rollbackSelection }));
  await rename(stateFile + ".tmp", stateFile);
}
async function restoreDevelopment(mode: Mode): Promise<boolean> {
  if (mode !== "development" || previous?.mode !== mode || previous.process.exitCode !== null) return false;
  const restored = previous;
  await waitForHealthy(restored.process, restored.port);
  await saveMode(mode);
  previous = active;
  active = restored;
  return true;
}
async function createCandidate(mode: Mode, selected?: string): Promise<Running | undefined> {
  if (selected) await pin(selected);
  const port = nextPort++;
  const output = mode === "production" ? selected ? await releasePath(root, selected) : await productionBuild() : undefined;
  if (output && active?.mode === mode && active.generation === path.basename(output)) return;
  const child = output
    ? launch(fileURLToPath(new URL('./node-server.mts', import.meta.url)), [String(port), output], root, { ...process.env, NODE_ENV: "production" })
    : launch(vinext, ["dev", "--hostname", "127.0.0.1", "--port", String(port)], root, { ...process.env, AL_DASHBOARD_PORT: String(port) });
  pending = child;
  return { mode, port, process: child, generation: output && path.basename(output), id: randomUUID() };
}
async function activate(candidate: Running): Promise<void> {
  const child = candidate.process;
  await waitForHealthy(child, candidate.port);
  if (candidate.generation && !process.env.AL_DASHBOARD_PREBUILT)
    await withBuildLock(path.join(root, '.build'), () => rememberDashboard(root, candidate.generation!));
  await saveMode(candidate.mode);
  const retired = previous;
  previous = active;
  active = candidate;
  child.once("exit", () => {
    if (active?.process !== child) return;
    failure = "Dashboard stopped unexpectedly";
    active = previous?.process.exitCode === null ? previous : undefined;
    previous = undefined;
    rollbackSelection = active?.generation;
    void saveMode(active?.mode || 'production').then(() => pin()).catch(error => console.error('Could not persist dashboard fallback:', error));
  });
  pending = undefined;
  // Retain one prior server for assets requested by tabs opened before switching.
  await stop(retired?.process);
  if (!process.env.AL_DASHBOARD_PREBUILT) {
    try { await pin(); await cleanup(true); }
    catch (error) { console.error('Dashboard cleanup deferred:', error); }
  }
  console.log(dashboardReadyMessage(candidate.mode, publicPort));
}
async function rejectCandidate(candidate: Running | undefined, error: unknown): Promise<void> {
  await stop(candidate?.process || pending);
  pending = undefined;
  failure = error instanceof Error ? error.message : String(error);
  await pin();
}
async function changeMode(mode: Mode, selected?: string): Promise<void> {
  if (busy) throw new Error("A dashboard build is already in progress");
  if (active?.mode === mode && mode === "development") return;
  busy = true;
  failure = null;
  let candidate: Running | undefined;
  const priorSelection = rollbackSelection;
  try {
    rollbackSelection = selected;
    if (await restoreDevelopment(mode)) return;
    candidate = await createCandidate(mode, selected);
    if (candidate) await activate(candidate);
    else { await saveMode(mode); await pin(); }
  } catch (error) {
    rollbackSelection = priorSelection;
    await rejectCandidate(candidate, error);
    throw error;
  } finally { busy = false; }
}

async function handleBuilds(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      json(res, 200, await buildList()); return;
    }
    if (req.method !== 'POST') { json(res, 405, {error: 'Use GET or POST'}); return; }
    if (process.env.AL_DASHBOARD_PREBUILT) throw new Error('Container builds are immutable');
    if (![ `http://localhost:${publicPort}`, `http://127.0.0.1:${publicPort}` ].includes(req.headers.origin || '')) {
      json(res, 403, {error: 'Local dashboard origin required'}); return;
    }
    if (busy) { json(res, 409, {error: 'A dashboard operation is in progress'}); return; }
    await performBuildAction(await readBuildRequest(req), res);
  } catch (error) { json(res, 400, {error: error instanceof Error ? error.message : String(error)}); }
}
async function buildList() {
  return {active: active?.generation, previous: previous?.generation,
    pinned: rollbackSelection, builds: await dashboardHistory(root)};
}
interface BuildRequest {action: string; id?: string; apply?: boolean}
async function readBuildRequest(req: IncomingMessage): Promise<BuildRequest> {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 1024) throw new Error('Request too large'); }
  return JSON.parse(body) as BuildRequest;
}
async function performBuildAction(input: BuildRequest, res: ServerResponse): Promise<void> {
    // Recheck after reading the request body; another request may have started
    // an operation while this one was still arriving.
    if (busy) { json(res, 409, {error: 'A dashboard operation is in progress'}); return; }
    if (input.action === 'clean') {
      busy = true;
      try { json(res, 200, await cleanup(input.apply === true)); } finally { busy = false; }
      return;
    }
    if (input.action === 'rollback') {
      if (!(await dashboardHistory(root)).some(entry => entry.id === input.id)) throw new Error('Unknown dashboard build');
      await changeMode('production', input.id);
    } else if (input.action === 'resume') await changeMode('production');
    else throw new Error('Unknown build action');
    json(res, 200, {active: active?.generation, pinned: rollbackSelection});
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function proxy(req: IncomingMessage, res: ServerResponse, target: Running, fallback = true): void {
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: target.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${target.port}` },
    },
    (response) => {
      if (
        response.statusCode === 404 &&
        fallback &&
        previous &&
        req.method === "GET" &&
        /\.(js|css|woff2?)(\?|$)/.test(req.url || "")
      ) {
        response.resume();
        proxy(req, res, previous, false);
        return;
      }
      res.writeHead(response.statusCode || 502, response.headers);
      res.flushHeaders();
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) json(res, 502, { error: "Dashboard temporarily unavailable" });
    else res.end();
  });
  res.on("close", () => upstream.destroy());
  if (fallback) req.pipe(upstream);
  else upstream.end();
}

async function readModeRequest(req: IncomingMessage): Promise<Mode> {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 128) throw new Error("Request too large");
      }
      const { mode } = JSON.parse(body) as { mode: Mode };
      if (mode !== "development" && mode !== "production")
        throw new Error("Invalid dashboard mode");
  return mode;
}
async function handleMode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (process.env.AL_DASHBOARD_PREBUILT) {
      json(res, 409, { error: "Container builds are immutable. Rebuild the Docker image to update." });
      return;
    }
    // Requests changing the local supervisor must originate in this dashboard.
    if (
      req.headers.origin !== `http://localhost:${publicPort}` &&
      req.headers.origin !== `http://127.0.0.1:${publicPort}`
    ) {
      json(res, 403, { error: "Local dashboard origin required" });
      return;
    }
    try {
      const mode = await readModeRequest(req);
      if (busy) {
        json(res, 409, { error: "A dashboard build is already in progress" });
        return;
      }
      json(res, 202, { pending: true });
      void changeMode(mode).catch((error) => console.error(error.message));
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid request" });
    }
}

function supervisorState() {
  return {mode: active?.mode || null, busy, error: failure, immutable: !!process.env.AL_DASHBOARD_PREBUILT,
    instance: active?.id || null, ready: !!active && active.process.exitCode === null && !busy && !failure};
}
const server = createServer(async (req, res) => {
  if (req.url !== '/__dashboard/state' && redirectInternal(req, res)) return;
  if (req.url === '/__dashboard/builds') { await handleBuilds(req, res); return; }
  if (req.url?.startsWith("/party-api/")) {
    proxy(req, res, { port: Number(process.env.AL_INTERNAL_API_PORT) || 924 } as Running);
    return;
  }
  if (req.url === "/__dashboard/state" && req.method === "GET") {
    json(res, 200, supervisorState());
    return;
  }
  if (req.url === "/__dashboard/mode" && req.method === "POST") {
    await handleMode(req, res);
    return;
  }
  if (!active) {
    json(res, 503, { error: failure || "Dashboard is starting" });
    return;
  }
  proxy(req, res, active);
});

server.on("upgrade", (req, socket, head) => {
  if (!fromGateway(req)) { socket.destroy(); return; }
  if (!active) {
    socket.destroy();
    return;
  }
  const target = connect(active.port, "127.0.0.1", () => {
    target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined)
        target.write(`${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`);
    }
    target.write("\r\n");
    target.write(head);
    socket.pipe(target).pipe(socket);
  });
  target.on("error", () => socket.destroy());
  socket.on("error", () => target.destroy());
  socket.on("close", () => target.destroy());
});

async function shutdown(): Promise<void> {
  server.close();
  await Promise.all([stop(active?.process), stop(previous?.process), stop(pending)]);
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
server.listen(publicPort, "127.0.0.1", async () => {
  let mode: Mode = process.argv.includes("--production") || process.env.AL_DASHBOARD_PREBUILT ? "production" : "development";
  if (!process.argv.includes("--development") && !process.argv.includes("--production")) {
    try {
      const saved = JSON.parse(await readFile(stateFile, "utf8"));
      if (saved.mode === "production") mode = "production";
      rollbackSelection = saved.rollback;
    } catch {
      /* First launch uses HMR. */
    }
  }
  // A pinned rollback survives ordinary restarts, including --production.
  if (!rollbackSelection) rollbackSelection = (await readJson<{rollback?: string}>(stateFile))?.rollback;
  await changeMode(mode, rollbackSelection).catch((error) => console.error(error.message));
});

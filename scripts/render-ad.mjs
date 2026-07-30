import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import {
  AD_DURATION,
  AD_HEIGHT,
  AD_WIDTH,
  EXPORT_FPS,
  EXPORT_FRAME_COUNT,
} from "../app.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = resolve(ROOT, "assets/laththa-cake-ad-1080x1920.mp4");
const MANIFEST_PATH = resolve(ROOT, "assets/laththa-cake-ad-1080x1920.json");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
};

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known Chrome installation.
    }
  }
  throw new Error("Chrome was not found. Set CHROME_PATH to its executable.");
}

async function startStaticServer() {
  let frameSink = null;
  let receivedFrameCount = 0;
  const expectedFrameBytes = AD_WIDTH * AD_HEIGHT * 4;
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && requestUrl.pathname === "/__render_frame") {
        if (!frameSink) {
          response.writeHead(503).end("Frame encoder is not ready.");
          return;
        }
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const frame = Buffer.concat(chunks);
        if (frame.byteLength !== expectedFrameBytes) {
          response.writeHead(400).end(`Expected ${expectedFrameBytes} bytes, received ${frame.byteLength}.`);
          return;
        }
        if (!frameSink.write(frame)) await once(frameSink, "drain");
        receivedFrameCount += 1;
        response.writeHead(204).end();
        return;
      }

      const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "") || "index.html";
      const filePath = resolve(ROOT, relativePath);
      if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${sep}`)) {
        response.writeHead(403).end();
        return;
      }

      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        response.writeHead(404).end();
        return;
      }

      response.setHeader("Content-Type", MIME_TYPES[extname(filePath)] ?? "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      response.writeHead(200);
      if (request.method === "HEAD") response.end();
      else createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListening);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine renderer server port.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    setFrameSink: (sink) => {
      frameSink = sink;
    },
    getReceivedFrameCount: () => receivedFrameCount,
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    }),
  };
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

function startEncoder(args) {
  const child = spawn("ffmpeg", args, {
    cwd: ROOT,
    stdio: ["pipe", "inherit", "inherit"],
  });
  let exited = false;
  const done = new Promise((resolveEncoder, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      exited = true;
      if (code === 0) resolveEncoder();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
  return {
    child,
    input: child.stdin,
    done,
    hasExited: () => exited,
  };
}

function parseRate(value) {
  const [numerator, denominator = "1"] = String(value).split("/").map(Number);
  return numerator / denominator;
}

async function validateVideo(videoPath) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    videoPath,
  ], { capture: true });
  const probe = JSON.parse(stdout);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const frameCount = Number(video?.nb_read_frames);
  const fps = parseRate(video?.avg_frame_rate);
  const duration = Number(probe.format?.duration);

  const checks = [
    [video?.width === AD_WIDTH, `width must be ${AD_WIDTH}`],
    [video?.height === AD_HEIGHT, `height must be ${AD_HEIGHT}`],
    [Math.abs(fps - EXPORT_FPS) < 0.001, `frame rate must be ${EXPORT_FPS}fps`],
    [frameCount === EXPORT_FRAME_COUNT, `frame count must be ${EXPORT_FRAME_COUNT}`],
    [Math.abs(duration - (AD_DURATION / 1_000)) < 0.02, "duration must be 18 seconds"],
    [Boolean(audio), "an audio stream is required"],
    [Number(audio?.sample_rate) === 48_000, "audio sample rate must be 48kHz"],
    [audio?.channels === 2, "audio must be stereo"],
  ];
  const failed = checks.filter(([passes]) => !passes).map(([, message]) => message);
  if (failed.length) throw new Error(`Rendered MP4 failed validation: ${failed.join("; ")}`);

  return {
    width: video.width,
    height: video.height,
    fps,
    frameCount,
    duration,
    videoCodec: video.codec_name,
    pixelFormat: video.pix_fmt,
    audioCodec: audio.codec_name,
    audioSampleRate: Number(audio.sample_rate),
    audioChannels: audio.channels,
  };
}

async function main() {
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "laththa-render-"));
  const soundtrackPath = join(temporaryDirectory, "soundtrack.wav");
  const temporaryOutputPath = join(temporaryDirectory, "laththa-cake-ad.mp4");

  const staticServer = await startStaticServer();
  const chromePath = await findChrome();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    defaultViewport: {
      width: AD_WIDTH,
      height: AD_HEIGHT,
      deviceScaleFactor: 1,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--font-render-hinting=none",
    ],
  });

  let succeeded = false;
  let encoder = null;
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => {
      console.error(`[browser] ${error.message}`);
    });
    await page.goto(`${staticServer.url}/?render=1`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => Boolean(window.__cakeAd));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(({ width, height }) => {
      const canvas = document.querySelector("#adCanvas");
      document.body.replaceChildren(canvas);
      document.documentElement.style.cssText = `margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#000`;
      document.body.style.cssText = `margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#000`;
      canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
    }, { width: AD_WIDTH, height: AD_HEIGHT });

    if (!await page.$("#adCanvas")) throw new Error("Renderer canvas was not found.");
    console.log("Rendering the 18-second soundtrack offline...");
    const soundtrackBase64 = await page.evaluate(() => window.__cakeAd.renderSoundtrackWavBase64());
    await writeFile(soundtrackPath, Buffer.from(soundtrackBase64, "base64"));

    console.log("Starting constant-frame-rate ffmpeg encoder...");
    encoder = startEncoder([
      "-y",
      "-hide_banner",
      "-loglevel",
      "warning",
      "-nostats",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      `${AD_WIDTH}x${AD_HEIGHT}`,
      "-framerate",
      String(EXPORT_FPS),
      "-i",
      "pipe:0",
      "-i",
      soundtrackPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-frames:v",
      String(EXPORT_FRAME_COUNT),
      "-fps_mode",
      "cfr",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-profile:v",
      "high",
      "-level:v",
      "4.2",
      "-pix_fmt",
      "yuv420p",
      "-g",
      String(EXPORT_FPS * 2),
      "-keyint_min",
      String(EXPORT_FPS * 2),
      "-sc_threshold",
      "0",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      "-af",
      "loudnorm=I=-16:LRA=7:TP=-1.5",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-t",
      String(AD_DURATION / 1_000),
      "-movflags",
      "+faststart",
      "-metadata",
      "title=لَذَّة — إعلان كيكة الفراولة",
      temporaryOutputPath,
    ]);
    staticServer.setFrameSink(encoder.input);

    console.log(`Rendering ${EXPORT_FRAME_COUNT} deterministic frames at ${EXPORT_FPS}fps...`);
    for (let frameIndex = 0; frameIndex < EXPORT_FRAME_COUNT; frameIndex += 1) {
      const timelineMs = (frameIndex * 1_000) / EXPORT_FPS;
      await page.evaluate(async ({ time, width, height }) => {
        window.__cakeAd.drawFrame(time);
        const canvas = document.querySelector("#adCanvas");
        const pixels = canvas.getContext("2d").getImageData(0, 0, width, height).data;
        const response = await fetch("/__render_frame", { method: "POST", body: pixels });
        if (!response.ok) throw new Error(await response.text());
      }, { time: timelineMs, width: AD_WIDTH, height: AD_HEIGHT });
      if ((frameIndex + 1) % EXPORT_FPS === 0) {
        console.log(`  ${frameIndex + 1}/${EXPORT_FRAME_COUNT} frames`);
      }
    }
    if (staticServer.getReceivedFrameCount() !== EXPORT_FRAME_COUNT) {
      throw new Error(`Encoder received ${staticServer.getReceivedFrameCount()} of ${EXPORT_FRAME_COUNT} frames.`);
    }
    encoder.input.end();
    await encoder.done;
    encoder = null;
    await page.close();

    const metadata = await validateVideo(temporaryOutputPath);
    const sha256 = createHash("sha256").update(await readFile(temporaryOutputPath)).digest("hex");
    await rename(temporaryOutputPath, OUTPUT_PATH);
    await writeFile(MANIFEST_PATH, `${JSON.stringify({
      ...metadata,
      sha256,
      timelineDurationMs: AD_DURATION,
      renderer: "Chrome canvas frame sequence + ffmpeg",
    }, null, 2)}\n`);
    succeeded = true;
    console.log(`Validated MP4: ${metadata.width}x${metadata.height}, ${metadata.fps}fps, ${metadata.frameCount} frames, ${metadata.duration}s`);
    console.log(`Output: ${OUTPUT_PATH}`);
  } finally {
    if (encoder && !encoder.hasExited()) {
      encoder.input.destroy();
      encoder.child.kill("SIGTERM");
    }
    await browser.close();
    await staticServer.close();
    if (succeeded && process.env.KEEP_RENDER_FRAMES !== "1") {
      await rm(temporaryDirectory, { recursive: true, force: true });
    } else {
      console.log(`Renderer working files: ${temporaryDirectory}`);
    }
  }
}

async function verifyExistingVideo() {
  const metadata = await validateVideo(OUTPUT_PATH);
  const video = await readFile(OUTPUT_PATH);
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const sha256 = createHash("sha256").update(video).digest("hex");
  if (manifest.sha256 !== sha256) throw new Error("Rendered MP4 checksum does not match its manifest.");
  console.log(JSON.stringify({ ...metadata, sha256 }, null, 2));
}

if (process.argv.includes("--verify-only")) await verifyExistingVideo();
else await main();

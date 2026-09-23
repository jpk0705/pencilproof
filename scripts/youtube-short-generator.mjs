import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const WIDTH = 1080;
const HEIGHT = 1920;

const run = (file, args, cwd) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", rejectRun);
  child.on("close", (code) => code === 0
    ? resolveRun()
    : rejectRun(new Error(`FFMPEG_EXIT_${code}: ${stderr.slice(-1600)}`)));
});

const filterPath = (value) => value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");

const wrap = (value, width = 25, maxRows = 4) => {
  const rows = [];
  let row = "";
  for (const word of String(value ?? "").trim().split(/\s+/)) {
    if ((`${row} ${word}`).trim().length > width && row) {
      rows.push(row);
      row = word;
    } else {
      row = (`${row} ${word}`).trim();
    }
  }
  if (row) rows.push(row);
  return rows.slice(0, maxRows).join("\n");
};

export function validateShortPlan(plan) {
  if (!Array.isArray(plan?.scenes) || plan.scenes.length < 5 || plan.scenes.length > 8) {
    throw new Error("SHORT_SCENES_MUST_BE_5_TO_8");
  }
  const duration = plan.scenes.reduce((sum, scene) => {
    const seconds = Number(scene.duration);
    if (!String(scene.text ?? "").trim() || !Number.isFinite(seconds) || seconds < 4 || seconds > 10) {
      throw new Error("SHORT_SCENE_INVALID");
    }
    return sum + seconds;
  }, 0);
  if (duration < 30 || duration > 45) throw new Error("SHORT_DURATION_MUST_BE_30_TO_45");
  return true;
}

export async function generateYouTubeShort(plan, outputPath, options = {}) {
  validateShortPlan(plan);
  const ffmpeg = options.ffmpeg ?? "ffmpeg";
  const font = filterPath(options.font ?? "C:\\Windows\\Fonts\\arialbd.ttf");
  const temp = await mkdtemp(join(tmpdir(), "pencilproof-short-"));
  const totalDuration = plan.scenes.reduce((sum, scene) => sum + Number(scene.duration), 0);
  try {
    const parts = [];
    for (let index = 0; index < plan.scenes.length; index += 1) {
      const scene = plan.scenes[index];
      const headlineFile = `headline-${index}.txt`;
      const detailFile = `detail-${index}.txt`;
      const segment = join(temp, `scene-${index}.mp4`);
      await writeFile(join(temp, headlineFile), wrap(scene.text, 22, 4));
      await writeFile(join(temp, detailFile), wrap(scene.detail ?? "Compare the full written quote.", 30, 5));
      const filters = [
        `drawbox=x=0:y=0:w=${WIDTH}:h=${HEIGHT}:color=0x071426:t=fill`,
        "drawbox=x=58:y=58:w=964:h=1804:color=0xf6c343:t=5",
        "drawbox=x=98:y=210:w=884:h=1010:color=0x10233f:t=fill",
        "drawbox=x=98:y=1260:w=884:h=430:color=0xffffff:t=fill",
        `drawtext=fontfile='${font}':text='PENCILPROOF':x=110:y=95:fontsize=54:fontcolor=0xf6c343`,
        `drawtext=fontfile='${font}':text='${index + 1} / ${plan.scenes.length}':x=w-tw-110:y=105:fontsize=38:fontcolor=0xffffff`,
        `drawtext=fontfile='${font}':textfile='${headlineFile}':x=(w-tw)/2:y=430:fontsize=84:fontcolor=0xffffff:line_spacing=24`,
        `drawtext=fontfile='${font}':textfile='${detailFile}':x=(w-tw)/2:y=1350:fontsize=44:fontcolor=0x071426:line_spacing=18`,
        "drawtext=fontfile='" + font + "':text='ILLUSTRATIVE - VERIFY YOUR DOCUMENTS':x=(w-tw)/2:y=1760:fontsize=30:fontcolor=0xf6c343",
        "format=yuv420p",
      ].join(",");
      await run(ffmpeg, [
        "-y", "-f", "lavfi", "-i", `color=c=0x071426:s=${WIDTH}x${HEIGHT}:r=30`,
        "-vf", filters, "-t", String(scene.duration), "-an", segment,
      ], temp);
      parts.push(segment);
    }
    const concat = join(temp, "concat.txt");
    const silent = options.audio ? join(temp, "silent.mp4") : resolve(outputPath);
    await writeFile(concat, parts.map((part) => `file '${part.replace(/'/g, "'\\''")}'`).join("\n"));
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", silent], temp);
    if (options.audio) {
      await run(ffmpeg, [
        "-y", "-i", silent, "-i", resolve(options.audio), "-c:v", "copy", "-c:a", "aac",
        "-b:a", "160k", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-t", String(totalDuration),
        "-movflags", "+faststart", resolve(outputPath),
      ], temp);
    }
    return resolve(outputPath);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("youtube-short-generator.mjs")) {
  const [planPath, output, audio] = process.argv.slice(2);
  if (!planPath || !output) {
    console.error("Usage: node scripts/youtube-short-generator.mjs plan.json output.mp4 [narration.wav]");
    process.exit(2);
  }
  const plan = JSON.parse(await readFile(resolve(planPath), "utf8"));
  await generateYouTubeShort(plan, output, { audio });
  console.log(`Generated ${resolve(output)}`);
}

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const W = 1920; const H = 1080;
const run = (file, args, cwd) => new Promise((ok, fail) => { const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"] }); let error = ""; child.stderr.on("data", (chunk) => { error += chunk; }); child.on("error", fail); child.on("close", (code) => code === 0 ? ok() : fail(new Error(`FFMPEG_EXIT_${code}: ${error.slice(-1200)}`))); });
const filterPath = (value) => value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
const wrap = (value, width = 34) => { const rows=[]; let row=""; for(const word of String(value).trim().split(/\s+/)){ if((row+" "+word).trim().length>width){ rows.push(row); row=word; } else row=(row+" "+word).trim(); } if(row) rows.push(row); return rows.slice(0,3).join("\n"); };

export function validateExplainerPlan(plan) {
  if (!plan?.sourceImage || !Array.isArray(plan.scenes) || plan.scenes.length < 8 || plan.scenes.length > 16) throw new Error("EXPLAINER_SCENES_MUST_BE_8_TO_16");
  const duration = plan.scenes.reduce((sum, scene) => { if (!String(scene.text ?? "").trim() || !Number.isFinite(Number(scene.duration)) || Number(scene.duration) < 5 || Number(scene.duration) > 20) throw new Error("EXPLAINER_SCENE_INVALID"); if (!scene.crop || ![scene.crop.x,scene.crop.y,scene.crop.width,scene.crop.height].every((value)=>Number.isFinite(Number(value)))) throw new Error("EXPLAINER_CROP_INVALID"); return sum + Number(scene.duration); }, 0);
  if (duration < 120 || duration > 240) throw new Error("EXPLAINER_DURATION_MUST_BE_120_TO_240");
  return true;
}

export async function generateYouTubeExplainer(plan, outputPath, options = {}) {
  validateExplainerPlan(plan); const ffmpeg = options.ffmpeg ?? "ffmpeg"; const font = filterPath(options.font ?? "C:\\Windows\\Fonts\\arialbd.ttf"); const temp = await mkdtemp(join(tmpdir(), "pencilproof-explainer-"));
  try {
    const parts=[];
    for(let i=0;i<plan.scenes.length;i++){
      const scene=plan.scenes[i]; const mainFile=`main-${i}.txt`; const captionFile=`caption-${i}.txt`; const mp4=join(temp,`scene-${i}.mp4`); await writeFile(join(temp,mainFile),wrap(scene.text)); await writeFile(join(temp,captionFile),wrap(scene.caption ?? "Review the complete written quote", 62)); const frames=Math.round(Number(scene.duration)*30); const c=scene.crop;
      const vf=[`crop=${c.width}:${c.height}:${c.x}:${c.y}`,`scale=${W}:${H}:force_original_aspect_ratio=increase`,`crop=${W}:${H}`,`zoompan=z='min(zoom+0.00018,1.035)':d=${frames}:s=${W}x${H}:fps=30`,`drawbox=x=55:y=55:w=1810:h=970:color=0xf6c343:t=4`,`drawbox=x=55:y=650:w=1810:h=375:color=0x061126@0.88:t=fill`,`drawtext=fontfile='${font}':text='PENCILPROOF':x=90:y=88:fontsize=34:fontcolor=0xf6c343`,`drawtext=fontfile='${font}':text='${i+1} / ${plan.scenes.length}':x=w-tw-90:y=88:fontsize=30:fontcolor=0xffffff`,`drawtext=fontfile='${font}':textfile='${mainFile}':x=105:y=705:fontsize=66:fontcolor=0xffffff:line_spacing=14`,`drawtext=fontfile='${font}':textfile='${captionFile}':x=108:y=920:fontsize=31:fontcolor=0xf6c343`,`format=yuv420p`].join(",");
      await run(ffmpeg,["-y","-loop","1","-i",resolve(plan.sourceImage),"-vf",vf,"-t",String(scene.duration),"-an",mp4],temp); parts.push(mp4);
    }
    const list=join(temp,"concat.txt"); const silent=options.audio?join(temp,"silent.mp4"):resolve(outputPath); await writeFile(list,parts.map((p)=>`file '${p.replace(/'/g,"'\\''")}'`).join("\n")); await mkdir(dirname(resolve(outputPath)),{recursive:true}); await run(ffmpeg,["-y","-f","concat","-safe","0","-i",list,"-c","copy",silent],temp); if(options.audio) await run(ffmpeg,["-y","-i",silent,"-i",resolve(options.audio),"-c:v","copy","-c:a","aac","-b:a","160k","-t",String(plan.scenes.reduce((s,x)=>s+Number(x.duration),0)),resolve(outputPath)],temp); return resolve(outputPath);
  } finally { await rm(temp,{recursive:true,force:true}); }
}

if (process.argv[1]?.endsWith("youtube-explainer-generator.mjs")) { const [planPath, output, audio] = process.argv.slice(2); if(!planPath||!output){console.error("Usage: node scripts/youtube-explainer-generator.mjs plan.json output.mp4 [narration.wav]");process.exit(2);} const plan=JSON.parse(await readFile(resolve(planPath),"utf8")); await generateYouTubeExplainer(plan,output,{audio}); console.log(`Generated ${resolve(output)}`); }

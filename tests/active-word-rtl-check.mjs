import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderActiveWordSrt } from "../src/activeWordSubtitles.js";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "active-word-rtl-"));
const segments = [{id:1,start:0,end:3,text:"כן, כן! עכשיו בדיקה"}];
const words = [{word:"כן",start:0,end:.7},{word:"כן",start:1,end:1.5},{word:"עכשיו",start:1.5,end:2.5},{word:"בדיקה",start:2.5,end:3}];
const base = renderActiveWordSrt(segments,words).replace(/[\u202a-\u202e]/g, "");
for (const [name, content] of [["plain",base],["rlm",base.replace(/<font/g,"\u200f<font")],["rle",renderActiveWordSrt(segments,words)]]) {
  const subtitle = path.join(directory,`${name}.srt`);
  await fs.writeFile(subtitle,content);
  const filter = `subtitles='${subtitle.replace(/\\/g,"/").replace(/:/g,"\\:")}':force_style='Fontsize=40,PlayResX=544,PlayResY=960,Alignment=2,MarginV=120,Encoding=-1'`;
  const r = spawnSync("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","color=black:s=544x960:d=1","-vf",filter,"-ss","0.3","-frames:v","1",path.join(directory,`${name}.png`)]);
  if(r.status) throw new Error(r.stderr.toString());
}
console.log(directory);

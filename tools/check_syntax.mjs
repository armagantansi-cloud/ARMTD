import { readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const TARGET_DIRS = ["game", "tools"];

function walk(dir){
  const out = [];
  const rows = readdirSync(dir, { withFileTypes: true });
  for (const row of rows) {
    const abs = join(dir, row.name);
    if (row.isDirectory()) {
      out.push(...walk(abs));
      continue;
    }
    if (extname(row.name) !== ".js" && extname(row.name) !== ".mjs") continue;
    out.push(abs);
  }
  return out;
}

function listTargets(){
  const files = [];
  for (const rel of TARGET_DIRS) {
    const abs = join(ROOT, rel);
    let st = null;
    try {
      st = statSync(abs);
    } catch (_) {
      continue;
    }
    if (!st.isDirectory()) continue;
    files.push(...walk(abs));
  }
  files.sort();
  return files;
}

function checkFile(absPath){
  const run = spawnSync(process.execPath, ["--check", absPath], {
    cwd: ROOT,
    encoding: "utf8"
  });
  return {
    ok: run.status === 0,
    code: run.status ?? 1,
    stderr: run.stderr || "",
    stdout: run.stdout || ""
  };
}

const files = listTargets();
if (!files.length) {
  console.error("[check:syntax] no target files found.");
  process.exit(1);
}

const failures = [];
for (const file of files) {
  const res = checkFile(file);
  if (!res.ok) {
    failures.push({
      file: relative(ROOT, file),
      code: res.code,
      out: (res.stderr || res.stdout).trim()
    });
  }
}

if (failures.length) {
  console.error(`[check:syntax] failed ${failures.length}/${files.length} files`);
  for (const f of failures) {
    console.error(`- ${f.file} (exit ${f.code})`);
    if (f.out) console.error(f.out);
  }
  process.exit(1);
}

console.log(`[check:syntax] ok ${files.length} files`);

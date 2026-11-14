#!/usr/bin/env node
// Release Grab: set the version, build the signed installer, publish it to GitHub Releases.
//
//   pnpm release version 0.2.0      set the version in package.json, tauri.conf.json, Cargo.toml
//   pnpm release build              build the signed installer (needs the signing key, see below)
//   pnpm release publish "notes"    upload the installer + latest.json as release v<version>
//
// The updater in installed copies reads latest.json from the newest release and only accepts
// installers signed with the private key in %USERPROFILE%\.tauri\grab.key (or the
// TAURI_SIGNING_PRIVATE_KEY env var). Keep that key safe: without it, no more updates.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "yashupare/grab";
const root = join(import.meta.dirname, "..");
const confPath = join(root, "src-tauri", "tauri.conf.json");
const pkgPath = join(root, "package.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");

const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};
// pnpm is a .cmd on Windows and needs a shell; everything else runs directly so arguments with
// spaces (titles, notes) stay intact.
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, shell: process.platform === "win32" && cmd === "pnpm", ...opts });
const version = () => JSON.parse(readFileSync(confPath, "utf8")).version;

function setVersion(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) fail("Give a version like 0.2.0");
  for (const p of [confPath, pkgPath]) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    j.version = v;
    writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  }
  const cargo = readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${v}"`);
  writeFileSync(cargoPath, cargo);
  console.log(`Version set to ${v}. Commit it, then: pnpm release build`);
}

function build() {
  const env = { ...process.env };
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    const keyFile = join(homedir(), ".tauri", "grab.key");
    if (!existsSync(keyFile)) fail(`Signing key not found at ${keyFile}. Set TAURI_SIGNING_PRIVATE_KEY.`);
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8");
  }
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
  run("pnpm", ["tauri", "build"], { env });
  const { exe } = artifacts();
  console.log(`\nBuilt ${exe}\nNext: pnpm release publish "What's new in ${version()}"`);
}

function artifacts() {
  const v = version();
  const dir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
  const name = `Grab_${v}_x64-setup.exe`;
  const exe = join(dir, name);
  const sig = `${exe}.sig`;
  if (!existsSync(exe) || !existsSync(sig)) fail(`No signed installer for ${v} in ${dir}. Run: pnpm release build`);
  return { v, dir, name, exe, sig };
}

function publish(notes) {
  const { v, dir, name, exe, sig } = artifacts();
  const latest = {
    version: v,
    notes: notes || `Grab ${v}`,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: readFileSync(sig, "utf8").trim(),
        url: `https://github.com/${REPO}/releases/download/v${v}/${name}`,
      },
    },
  };
  const latestPath = join(dir, "latest.json");
  writeFileSync(latestPath, JSON.stringify(latest, null, 2) + "\n");
  run("gh", ["release", "create", `v${v}`, "--repo", REPO, "--title", `Grab ${v}`, "--notes", latest.notes, exe, latestPath]);
  console.log(`\nPublished v${v}. Installed copies will offer it within a day (or Settings → Updates → Check now).`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "version") setVersion(arg);
else if (cmd === "build") build();
else if (cmd === "publish") publish(arg);
else fail("Usage: pnpm release version <x.y.z> | build | publish \"notes\"");

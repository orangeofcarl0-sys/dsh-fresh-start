import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest } from "@dsh-std/manifest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = parseManifest(readFileSync(join(root, "dsh-plugin.json"), "utf8"), {
  source: "dsh-plugin.json",
});

function check(name, ok) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

check("manifest parses under @dsh-std/manifest Community v0.15 rules", Boolean(manifest && manifest.manifestVersion === "0.15"));
check(`id is reverse-DNS (${manifest.id})`, manifest.id === "io.github.orangeofcarl0-sys.dsh-fresh-start");
check(`version tracks package.json (${pkg.version})`, manifest.version === pkg.version);
check("facets.host.apiVersion is v1alpha1", manifest.facets.host.apiVersion === "v1alpha1");
const entry = manifest.facets.host.entry;
check(`host entry file exists (${entry})`, typeof entry === "string" && existsSync(join(root, entry)));
check("contributes.commands empty (no second /fresh projected into native registry)", Array.isArray(manifest.contributes?.commands) && manifest.contributes.commands.length === 0);
check("permissions empty", Array.isArray(manifest.permissions) && manifest.permissions.length === 0);

if (!process.exitCode) console.log("ALL PASS");

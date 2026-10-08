import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(rootDir, "web");
const templateDir = join(rootDir, "scripts", "static-app");
const releaseDir = join(rootDir, "release", "static-app");
const appDir = join(releaseDir, "app");
const version = (await readFile(join(rootDir, "VERSION"), "utf8")).trim() || "dev";
const isWindows = process.platform === "win32";
const launcherName = `infinite-canvas-launcher${isWindows ? ".exe" : ""}`;

async function main() {
    await rm(releaseDir, { recursive: true, force: true });
    await mkdir(releaseDir, { recursive: true });

    await run("bun", ["run", "build"], webDir);
    await run("bun", ["build", join(templateDir, "server.mjs"), "--compile", "--outfile", join(releaseDir, launcherName)], rootDir);

    await cp(join(webDir, "dist"), appDir, { recursive: true });
    await copyTemplate("README.txt");
    await copyTemplate("start.cmd");
    await copyTemplate("start.ps1");
    await copyTemplate("start.sh");
    await chmod(join(releaseDir, "start.sh"), 0o755).catch(() => {});

    const manifest = {
        name: "infinite-canvas-static-app",
        version,
        launcher: launcherName,
        defaultUrl: "http://127.0.0.1:3000",
        generatedAt: new Date().toISOString(),
    };
    await writeFile(join(releaseDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    console.log(`Static package created at ${releaseDir}`);
}

async function copyTemplate(name) {
    const source = join(templateDir, name);
    const target = join(releaseDir, name);
    let content = await readFile(source, "utf8");
    if (name === "start.sh" && isWindows) content = content.replace("infinite-canvas-launcher", launcherName);
    if (name === "README.txt") content = content.replaceAll("infinite-canvas-launcher", launcherName);
    await writeFile(target, content, "utf8");
}

function run(command, args, cwd) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, { cwd, stdio: "inherit", shell: isWindows && extname(command) === "" });
        child.on("error", rejectPromise);
        child.on("exit", (code) => (code === 0 ? resolvePromise(undefined) : rejectPromise(new Error(`${command} ${args.join(" ")} failed with code ${code ?? 1}`))));
    });
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

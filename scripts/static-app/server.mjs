import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

function parseArgs(argv) {
    const args = { host: "127.0.0.1", port: 3000, open: true, root: resolve(defaultAppRoot()) };
    for (let i = 0; i < argv.length; i += 1) {
        const part = argv[i];
        if (part === "--host" && argv[i + 1]) args.host = argv[++i];
        else if (part === "--port" && argv[i + 1]) args.port = Number(argv[++i]) || 3000;
        else if (part === "--root" && argv[i + 1]) args.root = resolve(argv[++i]);
        else if (part === "--open") args.open = true;
        else if (part === "--no-open") args.open = false;
        else if (part === "--help" || part === "-h") {
            console.log("Usage: infinite-canvas-launcher [--root <dir>] [--host <host>] [--port <port>] [--open|--no-open]");
            process.exit(0);
        }
    }
    return args;
}

function defaultAppRoot() {
    const current = typeof process.execPath === "string" && process.execPath ? dirname(process.execPath) : dirname(fileURLToPath(import.meta.url));
    return join(current, "app");
}

function safePath(root, pathname) {
    const decoded = decodeURIComponent(pathname.split("?")[0]);
    const relative = normalize(decoded.replace(/^\/+/, ""));
    const target = resolve(root, relative);
    const rootWithSeparator = `${root}${root.endsWith(sep) ? "" : sep}`;
    return target === root || target.startsWith(rootWithSeparator) ? target : root;
}

function sendBuffer(res, status, buffer, type) {
    res.writeHead(status, { "Content-Type": type, "Content-Length": buffer.byteLength });
    res.end(buffer);
}

async function readIndexHtml(root) {
    return readFile(join(root, "index.html"));
}

function openBrowser(url) {
    const platform = process.platform;
    const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    await access(join(options.root, "index.html"));
    const indexHtml = await readIndexHtml(options.root);

    const server = createServer((req, res) => {
        const method = req.method || "GET";
        if (method !== "GET" && method !== "HEAD") {
            res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Method Not Allowed");
            return;
        }

        const requestUrl = new URL(req.url || "/", `http://${options.host}:${options.port}`);
        let filePath = safePath(options.root, requestUrl.pathname);
        if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");

        const extension = extname(filePath).toLowerCase();
        const isAssetRequest = extension.length > 0;

        if (existsSync(filePath) && statSync(filePath).isFile()) {
            const type = MIME_TYPES[extension] || "application/octet-stream";
            const headers = { "Content-Type": type, ...(requestUrl.pathname === "/config.js" ? { "Cache-Control": "no-store" } : {}) };
            res.writeHead(200, headers);
            if (method === "HEAD") return res.end();
            createReadStream(filePath).pipe(res);
            return;
        }

        if (!isAssetRequest) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            if (method === "HEAD") return res.end();
            return res.end(indexHtml);
        }

        sendBuffer(res, 404, Buffer.from("Not Found"), "text/plain; charset=utf-8");
    });

    server.listen(options.port, options.host, () => {
        const url = `http://${options.host}:${options.port}`;
        console.log(`Infinite Canvas static app is running at ${url}`);
        console.log(`Serving files from ${options.root}`);
        console.log("Press Ctrl+C to stop.");
        if (options.open) openBrowser(url);
    });
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

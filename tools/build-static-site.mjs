import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const publicDir = join(root, "public");
const serverDir = join(dist, "server");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(publicDir, dist, { recursive: true });
await mkdir(serverDir, { recursive: true });
await mkdir(join(dist, ".openai"), { recursive: true });
await cp(join(root, ".openai", "hosting.json"), join(dist, ".openai", "hosting.json"));

const files = await collectFiles(publicDir);
const assets = [];

for (const relativePath of files) {
  const content = await readFile(join(publicDir, relativePath), "utf8");
  const urlPath = `/${relativePath.replaceAll("\\", "/")}`;
  assets.push([urlPath, {
    content,
    type: contentType(urlPath),
  }]);
}

const serverSource = `const ASSETS = new Map(${JSON.stringify(assets)});

function assetForPath(pathname) {
  if (pathname === "/") return ASSETS.get("/index.html");
  return ASSETS.get(pathname) || ASSETS.get("/index.html");
}

function responseFor(request) {
  const url = new URL(request.url);
  const asset = assetForPath(url.pathname);
  return new Response(asset.content, {
    headers: {
      "content-type": asset.type,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

export default {
  fetch: responseFor,
};

export const fetch = responseFor;
`;

await writeFile(join(serverDir, "index.js"), serverSource);

async function collectFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const output = [];

  for (const entry of entries) {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      output.push(...await collectFiles(join(dir, entry.name), relativePath));
    } else if (entry.isFile()) {
      output.push(relativePath);
    }
  }

  return output;
}

function contentType(pathname) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

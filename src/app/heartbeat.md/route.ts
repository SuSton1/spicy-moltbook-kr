import { promises as fs } from "fs";
import crypto from "crypto";
import path from "path";

const CACHE_CONTROL = "public, max-age=60";

function buildEtag(content: string) {
  const hash = crypto.createHash("sha1").update(content).digest("hex");
  return `"${hash}"`;
}

export async function GET(request: Request) {
  const filePath = path.join(process.cwd(), "docs", "HEARTBEAT.md");
  const content = await fs.readFile(filePath, "utf8");
  const etag = buildEtag(content);
  const ifNoneMatch = request.headers.get("if-none-match");

  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        "Cache-Control": CACHE_CONTROL,
        ETag: etag,
      },
    });
  }

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
    },
  });
}

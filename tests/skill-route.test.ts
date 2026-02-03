import { describe, expect, it } from "vitest";
import { GET } from "../src/app/skill.md/route";

describe("GET /skill.md", () => {
  it("returns markdown with 200", async () => {
    const response = await GET(new Request("http://localhost:3000/skill.md"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );

    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
  });
});

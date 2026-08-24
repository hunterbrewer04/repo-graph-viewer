import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildShareHash,
  decodeSharePayload,
  encodeSharePayload,
  MAX_DECOMPRESSED,
  MAX_HASH_CHARS,
  parseShareHash,
} from "./shareUrl";

const GRAPH_JSON = JSON.stringify({
  nodes: [
    { id: "a", label: "Alpha", community: 0 },
    { id: "b", label: "Beta", community: 1 },
  ],
  links: [{ source: "a", target: "b", relation: "CALLS" }],
});

describe("encode/decode round-trip", () => {
  it("round-trips arbitrary JSON through deflate-raw + base64url", async () => {
    const payload = await encodeSharePayload(GRAPH_JSON);
    expect(payload).not.toContain("+");
    expect(payload).not.toContain("/");
    expect(payload).not.toMatch(/=+$/); // padding-free
    expect(await decodeSharePayload(payload)).toBe(GRAPH_JSON);
  });

  it("compresses repetitive graph JSON substantially", async () => {
    const payload = await encodeSharePayload(GRAPH_JSON.repeat(50));
    // Real graphs are highly repetitive; assert meaningful shrinkage.
    expect(payload.length).toBeLessThan(GRAPH_JSON.repeat(50).length / 2);
    await expect(decodeSharePayload(payload)).resolves.toBe(
      GRAPH_JSON.repeat(50),
    );
  });

  it("handles unicode content intact", async () => {
    const text = JSON.stringify({ label: "héllo — 世界 🎉" });
    const payload = await encodeSharePayload(text);
    await expect(decodeSharePayload(payload)).resolves.toBe(text);
  });
});

describe("size guards", () => {
  it("rejects encodes that would exceed the hash budget", async () => {
    // Random bytes defeat compression; 4 MB of noise stays ~4 MB through
    // deflate and blows well past the 2M-char base64url budget.
    const huge = randomBytes(4_000_000).toString("hex");
    await expect(encodeSharePayload(huge)).rejects.toThrow(/too large/i);
  }, 20_000);

  it("rejects decodes whose decompressed output exceeds 16 MB", async () => {
    const bomb = "y".repeat(MAX_DECOMPRESSED + 1);
    const payload = await encodeSharePayload(bomb);
    expect(payload.length).toBeLessThan(MAX_HASH_CHARS); // compresses fine
    await expect(decodeSharePayload(payload)).rejects.toThrow(
      /exceeds size limit/,
    );
  }, 20_000);

  it("aborts a high-ratio deflate bomb without materializing it", async () => {
    // ~1000x expansion: this input would decompress to 20 MB (1.25x the
    // limit). The guard must fire mid-stream (bounded memory) — the rejection
    // proves the bomb was cut off before the full output was built.
    const payload = await encodeSharePayload("bomb\u0000".repeat(4_000_000));
    expect(payload.length).toBeLessThan(MAX_HASH_CHARS);
    await expect(decodeSharePayload(payload)).rejects.toThrow(
      /exceeds size limit/,
    );
  }, 30_000);

  it("accepts decodes exactly at the limit boundary", async () => {
    const atLimit = "z".repeat(MAX_DECOMPRESSED);
    const payload = await encodeSharePayload(atLimit);
    await expect(decodeSharePayload(payload)).resolves.toBe(atLimit);
  }, 20_000);
});

describe("garbage payloads", () => {
  it.each([
    ["!!!not-real"],
    ["gibberish-base64"],
    [Buffer.from("plain, not deflate").toString("base64url")], // valid b64, wrong codec
  ])("throws on %j", async (payload) => {
    await expect(decodeSharePayload(payload)).rejects.toThrow();
  });
});

describe("buildShareHash", () => {
  it("composes #g=<payload>", async () => {
    const hash = await buildShareHash(GRAPH_JSON);
    expect(hash).toMatch(/^#g=[A-Za-z0-9_-]+$/);
    const parsed = parseShareHash(hash);
    expect(parsed?.payload).toBe(await encodeSharePayload(GRAPH_JSON));
    expect(parsed?.nodeId).toBeNull();
  });

  it("appends &n=<percent-encoded id> when a node is selected", async () => {
    const hash = await buildShareHash(GRAPH_JSON, "src/a b.ts::weird&id");
    expect(hash).toContain("&n=src%2Fa%20b.ts%3A%3Aweird%26id");
    expect(parseShareHash(hash)?.nodeId).toBe("src/a b.ts::weird&id");
  });
});

describe("parseShareHash edge cases", () => {
  it("returns null for empty / non-share fragments", () => {
    for (const hash of ["", "#", "#other=1", "#n=x"]) {
      expect(parseShareHash(hash)).toBeNull();
    }
  });

  it("returns null for bare #g= with no payload", () => {
    expect(parseShareHash("#g=")).toBeNull();
    expect(parseShareHash("#g=&n=a")).toBeNull();
  });

  it("parses payload-only hashes with or without leading #", () => {
    expect(parseShareHash("g=abc")?.payload).toBe("abc");
    expect(parseShareHash("#g=abc")?.payload).toBe("abc");
  });

  it("percent-decodes n= and ignores extra keys", () => {
    const parsed = parseShareHash("#g=payload&mode=3d&n=%C3%A9x");
    expect(parsed?.payload).toBe("payload");
    expect(parsed?.nodeId).toBe("éx");
  });

  it("treats a valueless n= as absent", () => {
    expect(parseShareHash("#g=payload&n=")?.nodeId).toBeNull();
  });

  it("degrades malformed percent-encoding in n= to no selection", () => {
    // %ZZ is invalid percent-encoding; decodeURIComponent throws URIError.
    // Selection is cosmetic (plan Assumption 6): payload must survive intact.
    const parsed = parseShareHash("#g=abc&n=%ZZ");
    expect(parsed?.payload).toBe("abc");
    expect(parsed?.nodeId).toBeNull();
  });
});

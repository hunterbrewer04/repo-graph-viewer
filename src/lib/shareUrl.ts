/**
 * Shareable-URL codec for graph state (card t_6a9f4ed4-d).
 *
 * A loaded graph is encoded into the URL *hash* as
 * `#g=<deflate-raw+base64url>` (+ optional `&n=<nodeId>` for the selection).
 * Hash, not query string: oversized URLs never reach servers, proxies, or
 * logs. The payload re-serializes the RAW uploaded JSON so the decode side
 * feeds straight into the untouched `loadGraph` — normalization stays a
 * single code path.
 *
 * `encodeSharePayload`/`decodeSharePayload` are async because
 * CompressionStream/DecompressionStream are stream APIs (available in all
 * evergreen browsers and Node ≥ 18, so vitest runs them unskipped).
 */

/** Reject encodes whose resulting hash would exceed this many chars. */
export const MAX_HASH_CHARS = 2_000_000;
/** Reject decodes whose decompressed output exceeds 16 MB. */
export const MAX_DECOMPRESSED = 16 * 1024 * 1024;

export const SHARE_ENCODE_TOO_LARGE =
  "This graph is too large to encode in a share link (limit ~2 MB compressed).";
export const SHARE_DECODE_TOO_LARGE = "Shared graph exceeds size limit.";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, ""); // padding-free base64url
}

function base64UrlToBytes(payload: string): Uint8Array {
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Raw graph JSON -> `deflate-raw` -> base64url, guarded at ~2 MB of hash. */
export async function encodeSharePayload(graphJson: string): Promise<string> {
  const stream = new Blob([graphJson])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const payload = bytesToBase64Url(bytes);
  if (payload.length > MAX_HASH_CHARS) throw new Error(SHARE_ENCODE_TOO_LARGE);
  return payload;
}

/** Inverse of `encodeSharePayload`; throws on garbage payloads and oversize. */
export async function decodeSharePayload(payload: string): Promise<string> {
  const bytes = base64UrlToBytes(payload);
  const stream = new Blob([bytes.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const text = await new Response(stream).text();
  if (text.length > MAX_DECOMPRESSED) throw new Error(SHARE_DECODE_TOO_LARGE);
  return text;
}

/**
 * Compose a full hash fragment from raw graph JSON:
 * `#g=<payload>` plus an optional `&n=<percent-encoded nodeId>`.
 */
export async function buildShareHash(
  graphJson: string,
  nodeId?: string | null,
): Promise<string> {
  const payload = await encodeSharePayload(graphJson);
  let hash = `#g=${payload}`;
  if (nodeId) hash += `&n=${encodeURIComponent(nodeId)}`;
  return hash;
}

/** A parsed `#g=` fragment: the payload plus an optional raw selection id. */
export interface ParsedShareHash {
  payload: string;
  /** Percent-DECODED node id from `n=`, or null when absent/empty. */
  nodeId: string | null;
}

/**
 * Parse a location.hash-style string (with or without leading `#`) into its
 * share parts. Synchronous and pure. Returns null for anything that is not a
 * `#g=<payload>[&...]` fragment (`""`, `"#"`, other fragments, bare `#g=`).
 */
export function parseShareHash(hash: string): ParsedShareHash | null {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!body) return null;
  let payload: string | undefined;
  let encodedNodeId: string | null = null;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === "g") {
      if (!value) return null; // `#g=` alone is not a share link
      payload = value;
    } else if (key === "n" && value) {
      encodedNodeId = value;
    }
  }
  if (payload === undefined) return null;
  return {
    payload,
    nodeId: encodedNodeId === null ? null : decodeURIComponent(encodedNodeId),
  };
}

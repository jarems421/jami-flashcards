import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Part } from "@google/generative-ai";
import mammoth from "mammoth";
import { load } from "cheerio";
import { OfficeParser } from "officeparser";
import type { Source } from "@/lib/practice/sources";
import {
  MAX_SOURCE_FILE_SIZE,
  getSourceFileKind,
  isSourceFileMimeType,
} from "@/lib/practice/source-files";

const SOURCE_CACHE_TTL_MS = 10 * 60 * 1000;
const SOURCE_CACHE_MAX_BYTES = 24 * 1024 * 1024;
const SOURCE_CACHE_ITEM_MAX_BYTES = 8 * 1024 * 1024;
const MAX_WEB_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_LENGTH = 30_000;
const MAX_REDIRECTS = 3;

type PreparedSource = {
  sourceId: string;
  label: string;
  parts: Part[];
  inputBytes: number;
};

type CacheEntry = {
  value: PreparedSource;
  expiresAt: number;
  bytes: number;
};

const sourceCache = new Map<string, CacheEntry>();
let sourceCacheBytes = 0;

export function normalizeSourceTutorIds(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().slice(0, 160))
        .filter(Boolean)
    )
  );
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_LENGTH);
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isBlockedSourceAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) === 6) {
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    );
  }
  return true;
}

async function assertPublicSourceUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public HTTP and HTTPS links can be read.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("This link points to a private network address.");
  }
  const addresses = await lookup(hostname, { all: true });
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isBlockedSourceAddress(entry.address))
  ) {
    throw new Error("This link points to a private network address.");
  }
  return url;
}

async function fetchPublicSourceText(value: string) {
  let currentUrl = await assertPublicSourceUrl(value);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "text/html,text/plain;q=0.9",
        "User-Agent": "Jami-Source-Tutor/1.0",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error("The link redirected too many times.");
      }
      currentUrl = await assertPublicSourceUrl(
        new URL(location, currentUrl).toString()
      );
      continue;
    }

    if (!response.ok) {
      throw new Error(`The link returned ${response.status}.`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error("The link does not provide a readable webpage.");
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_WEB_SOURCE_BYTES) {
      throw new Error("The webpage is too large to read safely.");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_WEB_SOURCE_BYTES) {
      throw new Error("The webpage is too large to read safely.");
    }

    const raw = buffer.toString("utf8");
    if (contentType.includes("text/plain")) {
      return normalizeExtractedText(raw);
    }

    const $ = load(raw);
    $("script,style,noscript,svg,nav,footer,form").remove();
    const title = $("title").first().text().trim();
    const mainText = $("main,article").first().text() || $("body").text();
    return normalizeExtractedText(`${title}\n\n${mainText}`);
  }

  throw new Error("The link could not be read.");
}

async function extractDocumentText(buffer: Buffer, fileType: string) {
  if (
    fileType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return normalizeExtractedText(result.value);
  }
  if (
    fileType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    const ast = await OfficeParser.parseOffice(buffer, {
      fileType: "pptx",
      ocr: false,
      extractAttachments: false,
      includeRawContent: false,
    });
    return normalizeExtractedText(ast.toText());
  }
  if (fileType === "text/plain") {
    return normalizeExtractedText(buffer.toString("utf8"));
  }
  throw new Error("This document type cannot be converted to text.");
}

function pruneCache(now: number) {
  for (const [key, entry] of sourceCache) {
    if (entry.expiresAt <= now) {
      sourceCache.delete(key);
      sourceCacheBytes -= entry.bytes;
    }
  }
}

function readCache(key: string) {
  const now = Date.now();
  pruneCache(now);
  const entry = sourceCache.get(key);
  return entry && entry.expiresAt > now ? entry.value : null;
}

function writeCache(key: string, value: PreparedSource) {
  const serializedBytes = value.parts.reduce((total, part) => {
    if ("text" in part && typeof part.text === "string") {
      return total + Buffer.byteLength(part.text);
    }
    if ("inlineData" in part && part.inlineData) {
      return total + Math.ceil((part.inlineData.data.length * 3) / 4);
    }
    return total;
  }, 0);
  if (serializedBytes > SOURCE_CACHE_ITEM_MAX_BYTES) return;

  pruneCache(Date.now());
  const existing = sourceCache.get(key);
  if (existing) {
    sourceCache.delete(key);
    sourceCacheBytes -= existing.bytes;
  }
  while (
    sourceCacheBytes + serializedBytes > SOURCE_CACHE_MAX_BYTES &&
    sourceCache.size > 0
  ) {
    const oldestKey = sourceCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = sourceCache.get(oldestKey);
    sourceCache.delete(oldestKey);
    sourceCacheBytes -= oldest?.bytes ?? 0;
  }
  sourceCache.set(key, {
    value,
    bytes: serializedBytes,
    expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
  });
  sourceCacheBytes += serializedBytes;
}

export async function prepareSourceForTutor(
  source: Source,
  loadStoredFile: (storagePath: string) => Promise<Buffer>
): Promise<PreparedSource> {
  const cacheKey = `${source.id}:${source.updatedAt}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const label = source.title || "Untitled source";
  let value: PreparedSource;

  if (source.contentText) {
    const text = normalizeExtractedText(source.contentText);
    value = {
      sourceId: source.id,
      label,
      inputBytes: Buffer.byteLength(text),
      parts: [{ text: `[Source: ${label}]\n${text}` }],
    };
  } else if (source.type === "link" && source.externalUrl) {
    const text = await fetchPublicSourceText(source.externalUrl);
    if (!text) throw new Error("The link did not contain readable text.");
    value = {
      sourceId: source.id,
      label,
      inputBytes: Buffer.byteLength(text),
      parts: [{ text: `[Source: ${label}]\n${text}` }],
    };
  } else if (source.type === "file" && source.storagePath && source.fileType) {
    if (!isSourceFileMimeType(source.fileType)) {
      throw new Error("This uploaded file type is not supported by Tutor.");
    }
    const buffer = await loadStoredFile(source.storagePath);
    if (buffer.byteLength <= 0 || buffer.byteLength > MAX_SOURCE_FILE_SIZE) {
      throw new Error("The uploaded file is empty or too large.");
    }
    const kind = getSourceFileKind(source.fileType);
    if (kind === "image" || kind === "pdf") {
      value = {
        sourceId: source.id,
        label,
        inputBytes: buffer.byteLength,
        parts: [
          { text: `[Source: ${label}]` },
          {
            inlineData: {
              mimeType: source.fileType,
              data: buffer.toString("base64"),
            },
          },
        ],
      };
    } else {
      const text = await extractDocumentText(buffer, source.fileType);
      if (!text) throw new Error("The document did not contain readable text.");
      value = {
        sourceId: source.id,
        label,
        inputBytes: buffer.byteLength,
        parts: [{ text: `[Source: ${label}]\n${text}` }],
      };
    }
  } else {
    throw new Error("This source does not contain readable material.");
  }

  writeCache(cacheKey, value);
  return value;
}

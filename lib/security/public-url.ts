import { isIP } from "node:net";

const SENSITIVE_QUERY_KEY =
  /(?:^|[_-])(?:token|auth|authorization|signature|sig|secret|session|password|credential|key)(?:$|[_-])/i;

function isNonPublicIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function expandIpv6(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const dottedIndex = value.lastIndexOf(":");
  let normalized = value;
  if (dottedIndex >= 0 && value.slice(dottedIndex + 1).includes(".")) {
    const dotted = value.slice(dottedIndex + 1);
    if (isIP(dotted) !== 4) return null;
    const octets = dotted.split(".").map(Number);
    normalized = `${value.slice(0, dottedIndex)}:${(
      (octets[0] << 8) |
      octets[1]
    ).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group || "0", 16));
  return groups.length === 8 && groups.every((group) => Number.isFinite(group))
    ? groups
    : null;
}

function isNonPublicIpv6(hostname: string) {
  const groups = expandIpv6(hostname);
  if (!groups) return true;
  const [first, second, third, fourth, fifth, sixth] = groups;
  const unspecified = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && sixth === 0xffff;
  const embeddedIpv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  return (
    unspecified ||
    loopback ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x2001 && second === 0) ||
    first === 0x2002 ||
    (ipv4Mapped && isNonPublicIpv4(embeddedIpv4)) ||
    // IPv4-compatible addresses can otherwise bypass the IPv4 ranges above.
    (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 &&
      isNonPublicIpv4(embeddedIpv4))
  );
}

/**
 * Accepts only a syntactically public HTTP(S) URL for a remote retrieval tool.
 *
 * This deliberately rejects local/reserved literal addresses, local hostnames,
 * credentials and secret-looking query parameters. It cannot prove that a DNS
 * name will keep resolving to a public address; the remote URL-fetch provider
 * must independently block DNS rebinding and private-address redirects.
 */
export function sanitizePublicHttpUrl(value: string) {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))) {
      return null;
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".home.arpa") ||
      (!hostname.includes(".") && isIP(hostname) === 0)
    ) {
      return null;
    }
    const addressKind = isIP(hostname);
    if (
      (addressKind === 4 && isNonPublicIpv4(hostname)) ||
      (addressKind === 6 && isNonPublicIpv6(hostname))
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

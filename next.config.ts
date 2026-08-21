import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

/**
 * Directives that cannot break resource loading, so they are safe to enforce
 * without first observing real traffic. They close clickjacking, base-tag
 * injection, plugin embedding and form hijacking.
 */
const ENFORCED_CSP = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * The restrictive policy, reported but not enforced.
 *
 * No external origin is hardcoded anywhere in the app -- the Firebase SDK
 * builds its endpoints at runtime from config -- so `connect-src` cannot be
 * verified by reading the source. Enforcing a guess would break Firestore,
 * Auth or Storage in production while every local gate stayed green.
 *
 * Report-Only surfaces violations in the browser console at no runtime cost
 * and with no risk to a working app. Promote to enforcement once a real
 * session reports clean.
 *
 * `script-src` keeps 'unsafe-inline' deliberately. The strong alternative is a
 * per-request nonce, which requires middleware and forces every page to render
 * dynamically -- this app prerenders most of its routes, so that trade costs
 * real serverless invocations to harden a surface that `trust: false` KaTeX and
 * the enforced directives above already cover.
 */
const REPORTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com http://127.0.0.1:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  ENFORCED_CSP,
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: ENFORCED_CSP },
  { key: "Content-Security-Policy-Report-Only", value: REPORTED_CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    // Vercel serves this over HTTPS. No `preload`, which is a one-way listing.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

export const nextConfig: NextConfig = {
  // PDF evidence rendering uses a native Skia binary and must remain a
  // server runtime dependency rather than being parsed by webpack.
  serverExternalPackages: ["@napi-rs/canvas", "mammoth", "officeparser"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return [
      {
        source: "/dashboard/practise",
        destination: "/dashboard/practice",
        permanent: true,
      },
    ];
  },
};

export default withWorkflow(nextConfig);

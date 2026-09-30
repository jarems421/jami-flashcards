import type { Card } from "@/lib/study/cards";

/**
 * Card pictures kept on the device, so a diagram can be studied offline.
 *
 * Offline study already keeps the cards themselves; without their pictures a
 * diagram card offline is a grey box. Two things make a picture available
 * with no connection:
 *
 * - its download URL, remembered here, because asking Firebase for one needs
 *   the network;
 * - the picture itself, in a cache the service worker answers from when the
 *   network cannot (`public/sw.js`).
 *
 * Pictures are fetched opaquely (`no-cors`): they are shown in `<img>`, never
 * read, so nothing needs the storage bucket to allow cross-origin reads.
 * Best effort throughout -- a picture that will not cache is a picture that
 * needs the network, nothing worse.
 */

/** Must match `CARD_IMAGE_CACHE` in public/sw.js. */
export const CARD_IMAGE_CACHE = "jami-card-images-v1";
const URL_STORE_KEY = "jami:card-image-urls:v1";
/** The soonest-due cards' pictures; a whole library's would be a lot of storage. */
const MAX_CACHED_PICTURES = 120;

function readUrls(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(URL_STORE_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeUrls(urls: Record<string, string>) {
  try {
    localStorage.setItem(URL_STORE_KEY, JSON.stringify(urls));
  } catch {
    // Storage full or blocked: pictures still load online.
  }
}

/** Remember a picture's download URL for when there is no network to ask. */
export function rememberCardImageUrl(storagePath: string, url: string) {
  const urls = readUrls();
  if (urls[storagePath] === url) return;
  urls[storagePath] = url;
  writeUrls(urls);
}

export function getRememberedCardImageUrl(storagePath: string) {
  return readUrls()[storagePath] ?? null;
}

/** Every picture a card shows, in the order the cards come. */
export function cardPicturePaths(cards: readonly Card[]) {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    for (const image of [card.occlusion?.diagram.image, card.frontImage, card.backImage]) {
      if (!image || seen.has(image.storagePath)) continue;
      seen.add(image.storagePath);
      paths.push(image.storagePath);
    }
  }
  return paths;
}

/**
 * Keep the pictures of the soonest cards on the device, and let go of the rest.
 *
 * `resolveUrl` is how a picture's URL is asked for; it is passed in so this
 * never imports the card image service it is used by.
 */
export async function cacheCardPicturesForOffline(
  cards: readonly Card[],
  resolveUrl: (storagePath: string) => Promise<string>
) {
  if (typeof caches === "undefined" || typeof fetch === "undefined") return;
  const paths = cardPicturePaths(cards).slice(0, MAX_CACHED_PICTURES);
  try {
    const cache = await caches.open(CARD_IMAGE_CACHE);
    const wanted = new Set<string>();
    for (const path of paths) {
      try {
        const url = await resolveUrl(path);
        wanted.add(url);
        if (await cache.match(url, { ignoreVary: true })) continue;
        const response = await fetch(url, { mode: "no-cors", credentials: "omit" });
        // Opaque responses cannot say whether they worked; a type of "error" can.
        if (response.type !== "error") await cache.put(url, response);
      } catch {
        // This picture needs the network; the rest can still be kept.
      }
    }
    for (const request of await cache.keys()) {
      if (!wanted.has(request.url)) await cache.delete(request);
    }
    // Forget URLs for pictures no longer kept, so the store stays small.
    const urls = readUrls();
    const kept = Object.fromEntries(Object.entries(urls).filter(([, url]) => wanted.has(url)));
    writeUrls(kept);
  } catch (error) {
    console.warn("Card pictures could not be kept for offline study.", error);
  }
}

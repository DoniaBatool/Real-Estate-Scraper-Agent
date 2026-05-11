/**
 * Scraped listings often store root-relative image paths (/content/uploads/…).
 * Without a base URL the browser loads them from the Next origin (localhost) and they 404.
 *
 * Paths without a leading slash are joined relative to the *last path segment* of the listing URL
 * (wrong for CMS assets like content/uploads/…). Treat common root segments as site-absolute.
 */
export function resolveListingImageUrl(raw: string, listingUrl?: string | null): string {
  let u = raw.trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return `https:${u}`;
  const base = listingUrl?.trim();
  if (!base) return u;
  try {
    if (!u.startsWith("/") && !u.startsWith("?") && !u.startsWith("#")) {
      if (/^(?:content|uploads|media|sites|wp-content|assets|files|images|public|static)\b/i.test(u)) {
        u = `/${u.replace(/^\/+/, "")}`;
      }
    }
    return new URL(u, base).href;
  } catch {
    return u;
  }
}

/** Route external listing images through our API so Referer/User-Agent match the agency site (hotlink bypass). */
export function proxiedListingImageUrl(absoluteUrl: string, listingUrl?: string | null): string {
  if (!absoluteUrl || !/^https?:\/\//i.test(absoluteUrl)) return absoluteUrl;
  const ref = listingUrl?.trim();
  if (!ref) return absoluteUrl;
  try {
    const img = new URL(absoluteUrl);
    const page = new URL(ref);
    const norm = (h: string) => h.replace(/^www\./i, "").toLowerCase();
    if (!img.hostname || !page.hostname || norm(img.hostname) !== norm(page.hostname)) {
      return absoluteUrl;
    }
  } catch {
    return absoluteUrl;
  }
  return `/api/properties/image-proxy?url=${encodeURIComponent(absoluteUrl)}&listing_url=${encodeURIComponent(ref)}`;
}

export function propertyImageSrc(raw: string, listingUrl?: string | null): string {
  return proxiedListingImageUrl(resolveListingImageUrl(raw, listingUrl), listingUrl);
}

export function resolvePropertyImages(images: string[] | undefined, listingUrl?: string | null): string[] {
  if (!images?.length) return [];
  return images.map((src) => propertyImageSrc(src, listingUrl));
}

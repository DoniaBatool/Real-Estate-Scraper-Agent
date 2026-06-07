/**
 * Tests for the gallery image ordering logic in PropertyCard (chat/page.tsx).
 *
 * Logic under test:
 *   validImages (real property photos) come FIRST
 *   carouselShots that aren't already in validImages come SECOND
 *   pageShot comes LAST (only if not already in validImages or carouselShots)
 *   All empty/falsy values are filtered out
 *
 * Run: node frontend/tests/gallery-ordering.test.mjs
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// ---- The function under test (extracted from chat/page.tsx) ----
function buildGalleryImages({ validImages = [], carouselShots = [], pageShot = "" } = {}) {
  return [
    ...validImages,
    ...carouselShots.filter(s => !validImages.includes(s)),
    ...(pageShot && !validImages.includes(pageShot) && !carouselShots.includes(pageShot) ? [pageShot] : []),
  ].filter(Boolean);
}
// ----------------------------------------------------------------

console.log("\n=== Gallery Image Ordering Tests ===\n");

// 1. validImages come first, before carouselShots
{
  console.log("Test 1: validImages appear before carouselShots");
  const result = buildGalleryImages({
    validImages: ["https://site.com/photo1.jpg", "https://site.com/photo2.jpg"],
    carouselShots: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"],
    pageShot: "",
  });
  assert(result[0] === "https://site.com/photo1.jpg", "first image is a real URL photo");
  assert(result[1] === "https://site.com/photo2.jpg", "second image is second URL photo");
  assert(result[2] === "data:image/png;base64,AAA", "carousel screenshot comes after URL photos");
  assert(result.length === 4, "all 4 images included");
}

// 2. No duplicate: carousel shot that's already in validImages is NOT added again
{
  console.log("\nTest 2: no duplicate if carousel shot is already in validImages");
  const shared = "data:image/png;base64,SHARED";
  const result = buildGalleryImages({
    validImages: [shared],
    carouselShots: [shared, "data:image/png;base64,OTHER"],
    pageShot: "",
  });
  assert(result.filter(x => x === shared).length === 1, "shared image appears exactly once");
  assert(result.length === 2, "total 2 images (shared + OTHER)");
}

// 3. pageShot appended last
{
  console.log("\nTest 3: pageShot comes last");
  const result = buildGalleryImages({
    validImages: ["https://site.com/a.jpg"],
    carouselShots: ["data:image/png;base64,CCC"],
    pageShot: "data:image/png;base64,PAGE",
  });
  assert(result[result.length - 1] === "data:image/png;base64,PAGE", "pageShot is last");
  assert(result.length === 3, "3 images total");
}

// 4. pageShot not duplicated if already in validImages
{
  console.log("\nTest 4: pageShot not duplicated if already in validImages");
  const shot = "data:image/png;base64,DUPE";
  const result = buildGalleryImages({
    validImages: [shot],
    carouselShots: [],
    pageShot: shot,
  });
  assert(result.filter(x => x === shot).length === 1, "pageShot not duplicated");
  assert(result.length === 1, "only 1 image in result");
}

// 5. pageShot not duplicated if already in carouselShots
{
  console.log("\nTest 5: pageShot not duplicated if already in carouselShots");
  const shot = "data:image/png;base64,DUPE2";
  const result = buildGalleryImages({
    validImages: [],
    carouselShots: [shot],
    pageShot: shot,
  });
  assert(result.filter(x => x === shot).length === 1, "pageShot not duplicated when in carouselShots");
}

// 6. Empty/falsy values filtered out
{
  console.log("\nTest 6: empty strings and falsy values filtered out");
  const result = buildGalleryImages({
    validImages: ["", "https://site.com/real.jpg", ""],
    carouselShots: ["", "data:image/png;base64,CCC"],
    pageShot: "",
  });
  assert(!result.includes(""), "no empty strings in result");
  assert(result[0] === "https://site.com/real.jpg", "real URL is first non-empty");
}

// 7. All empty inputs → empty array
{
  console.log("\nTest 7: all empty → empty array");
  const result = buildGalleryImages({ validImages: [], carouselShots: [], pageShot: "" });
  assert(result.length === 0, "empty result when all inputs empty");
}

// 8. Only validImages, nothing else
{
  console.log("\nTest 8: only validImages provided");
  const result = buildGalleryImages({
    validImages: ["https://a.com/1.jpg", "https://a.com/2.jpg"],
  });
  assert(result.length === 2, "2 images returned");
  assert(result[0] === "https://a.com/1.jpg", "order preserved");
}

// 9. Only carouselShots, no validImages (fallback behaviour)
{
  console.log("\nTest 9: only carouselShots, no validImages");
  const result = buildGalleryImages({
    carouselShots: ["data:image/png;base64,A", "data:image/png;base64,B"],
  });
  assert(result[0] === "data:image/png;base64,A", "carousel shots returned when no URL images");
  assert(result.length === 2, "both carousel shots included");
}

// 10. First item is NEVER blank when validImages exist (the original bug scenario)
{
  console.log("\nTest 10: first image is a real URL photo, not a screenshot (original bug scenario)");
  const result = buildGalleryImages({
    validImages: ["https://agency.mt/photo1.jpg"],
    carouselShots: ["data:image/png;base64,BLANK_SCREENSHOT", "data:image/png;base64,ACTUAL"],
    pageShot: "data:image/png;base64,FULL_PAGE",
  });
  assert(result[0].startsWith("https://"), "first gallery image is a real https URL, not a base64 screenshot");
}

// ── Blank image filtering (MIN_SCREENSHOT_B64 = 5000) ──────────────────────

const MIN_SCREENSHOT_B64 = 5000;

function filterCarouselShots(shots) {
  return shots.filter(s => s && s.startsWith("data:image/") && s.length > MIN_SCREENSHOT_B64);
}

function filterValidImages(images) {
  return images.filter(u => {
    if (!u) return false;
    if (u.startsWith("data:image/svg")) return false;
    if (u.startsWith("data:")) {
      const b64 = u.split(",")[1] || "";
      return b64.length > 200;
    }
    return u.startsWith("http://") || u.startsWith("https://");
  });
}

// 11. Short base64 carousel shots (blank/loading) are filtered out
{
  console.log("\nTest 11: short base64 carousel shots filtered out (blank screenshots)");
  const SHORT = "data:image/jpeg;base64," + "A".repeat(100);  // only 100 base64 chars → tiny
  const REAL  = "data:image/jpeg;base64," + "A".repeat(6000); // 6000 chars → real photo
  const shots = filterCarouselShots([SHORT, REAL]);
  assert(shots.length === 1, "short base64 string filtered out");
  assert(shots[0] === REAL, "real-length screenshot kept");
}

// 12. SVG data URIs filtered out of validImages (they're icons/logos, not photos)
{
  console.log("\nTest 12: SVG data URIs filtered from validImages");
  const imgs = filterValidImages([
    "data:image/svg+xml;base64,PHN2Zy...",
    "https://agency.com/photo.jpg",
    "data:image/png;base64," + "A".repeat(300), // long enough → kept
  ]);
  assert(!imgs.some(u => u.startsWith("data:image/svg")), "SVG data URI removed");
  assert(imgs.some(u => u.startsWith("https://")), "real https URL kept");
}

// 13. Very short data: URIs (< 200 chars base64) filtered from validImages
{
  console.log("\nTest 13: very short data: URIs filtered (blank/trivial placeholders)");
  const TINY  = "data:image/png;base64," + "iVBOR";  // only 5 chars of base64 → 1x1 pixel
  const REAL  = "data:image/png;base64," + "A".repeat(300); // 300 chars → real image
  const imgs = filterValidImages([TINY, REAL]);
  assert(imgs.length === 1, "tiny data URI filtered out");
  assert(imgs[0] === REAL, "real-length data URI kept");
}

// 14. Blank carousel shot removed → gallery count correct
{
  console.log("\nTest 14: blank carouselShot removed → count reflects only real images");
  const BLANK = "data:image/jpeg;base64," + "W".repeat(500);  // 500 chars → blank
  const REAL1 = "data:image/jpeg;base64," + "X".repeat(6000); // 6000 chars → real
  const REAL2 = "data:image/jpeg;base64," + "Y".repeat(7000); // 7000 chars → real
  const shots = filterCarouselShots([BLANK, REAL1, REAL2]);
  const gallery = buildGalleryImages({ carouselShots: shots });
  assert(gallery.length === 2, "only 2 real screenshots in gallery, blank excluded");
}

// ---- Summary ----
console.log(`\n${"=".repeat(40)}`);
if (failed === 0) {
  console.log(`✅ All ${passed} tests passed`);
} else {
  console.log(`❌ ${failed} failed, ${passed} passed`);
  process.exit(1);
}

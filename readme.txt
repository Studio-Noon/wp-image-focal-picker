=== Focal Point Images – Smart Crop, Responsive, Retina & WebP ===
Contributors: studionoon
Tags: focal point, image crop, responsive images, webp, retina
Requires at least: 6.4
Tested up to: 7.1
Requires PHP: 8.0
Stable tag: 1.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Set a focal point on any image and get smart-cropped, responsive, retina and WebP image sizes generated on the fly. No more regenerating thumbnails.

== Description ==

**Stop cropping heads off.** Pick a focal point on an image once and every cropped size — featured images, thumbnails, hero banners, block images, `srcset` — keeps that point in view. Sizes are generated on demand, at 1x, 1.5x and 2x for retina screens, as WebP when the browser supports it, and cached.

= What it does =

* **Focal point picker** in the media library, the featured-image panel, and the Image and Media & Text block sidebar. Set it once per image; it applies everywhere that image is used.
* **Suggest from faces**: one click finds the faces in the image (in your browser, nothing is uploaded anywhere) and puts the focal point where every cropped size keeps as many of them whole as possible. Each preview shows whether a crop keeps, tightens or cuts a face.
* **Full-screen editor with live crop previews** — the image on the left, every registered image size on the right, re-cropping in real time as you drag. Nothing is generated or saved until you apply.
* **Smart cropping** of every image size around the focal point. Uncropped sizes are constrained to fit, exactly as WordPress does.
* **On-the-fly image generation** through [Glide](https://glide.thephpleague.com/). WordPress writes only the thumbnail file at upload; other sizes are rendered on first request and cached. Add or change an image size and it just works — **no "Regenerate Thumbnails"**.
* **Retina / high-DPI `srcset`** at 1x, 1.5x and 2x for every size.
* **WebP** negotiated per request from the browser's `Accept` header. PNG and GIF keep their format, so transparency and animation are safe.
* **Responsive image sizes**: register a size with its own `srcset` width ladder, or a different focal-cropped box per viewport for art direction — output as a `<picture>` element, automatically.
* **Signed URLs** — with a secret configured (the default), only sizes your site asked for can be generated, so nobody can use the endpoint to burn CPU.
* **Cache warming** in the background (WP-Cron), from the media library bulk action, from Settings → Media, or `wp noon-focal warm` in WP-CLI.
* **Status panel** on Settings → Media that makes a live request and tells you whether the rewrite, secret, cache directory and image library all work.
* **Multisite** ready (network activation supported).

= How it works =

Every image URL for a size becomes a signed request like `photo.jpg?w=1024&h=576&fit=crop-30-60&s=…`. A rewrite rule sends it to the plugin's lightweight endpoint, which crops, resizes and encodes the original with GD or Imagick and caches the result in `wp-content/cache/noon-images`. Changing the focal point purges that image's cache.

Your original uploads are never modified.

= For developers =

Use the normal WordPress functions — `the_post_thumbnail()`, `wp_get_attachment_image()`, `wp_get_attachment_image_url()`, image blocks — they all return focal-cropped Glide URLs with a retina `srcset`.

Register responsive sizes:

`
noon_focal_add_image_size( 'hero', 640, 800, true, [
    'breakpoints' => [ 768 => [ 1280, 720 ], 1440 => [ 1920, 900 ] ], // <picture> with a box per viewport
] );
noon_focal_add_image_size( 'card', 800, 600, true ); // automatic srcset width ladder
`

Filters: `noon_focal_default_focus`, `noon_focal_dprs`, `noon_focal_auto_widths`, `noon_focal_responsive_sizes`, `noon_focal_preview_sizes`, `noon_focal_warm_sizes`, `noon_focal_warm_variants`, `noon_focal_enqueue_media_assets`. Action: `noon_focal_cache_purged`. Focal points are stored in attachment meta `noon_focal_point` (`{ x, y }`, 0–1) and exposed in the REST API.

Source and issues: [GitHub](https://github.com/Studio-Noon/wp-image-focal-picker).

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/` or install it from Plugins → Add New.
2. Activate it. A rewrite rule is written to `.htaccess` and a signing secret is generated automatically.
3. Open **Settings → Media → Focal images — status**. It makes a live request and tells you if anything needs attention.
4. Edit an image in the media library and click **Edit Focal Point**.

**nginx** ignores `.htaccess`. Add this to your server config (also shown on the status panel):

`
# http {}
map "$arg_direct:$arg_w:$arg_h:$arg_s" $noon_focal_glide {
    default 0;
    "~^:[0-9]+:[0-9]+:[a-f0-9]*$" 1;
}

# server {}, before any generic static-file location
location ~* ^/(?:[_0-9a-zA-Z-]+/)?wp-content/uploads/.+\.[a-z0-9]+$ {
    if ($noon_focal_glide) {
        rewrite ^ /wp-content/plugins/focal-point-images-smart-crop/media.php last;
    }
}
`

**Multisite**: WordPress never writes `.htaccess` on multisite. Network-activate the plugin; the block to paste is shown in Network Admin and on the status panel.

== Frequently Asked Questions ==

= Do I need to regenerate thumbnails after installing? =

No. Existing sizes are rendered on demand from the original the first time they are requested, so every image immediately follows its focal point and every registered size is available — including sizes you add later.

= Does it change my original uploads? =

No. Originals are untouched; renditions live in `wp-content/cache/noon-images` and can be deleted at any time.

= Where do I set the focal point? =

In the media library (Edit Focal Point in the attachment details), in the featured image panel of the block editor, and in the sidebar of Image and Media & Text blocks. The point belongs to the image, not to the place it is used, so setting it once covers every crop.

= Can I see how a crop will look before saving? =

Yes. All three pickers show live previews of every cropped image size, positioned exactly as they will be generated, and open a full-screen editor with large previews. The previews are drawn in the browser from the original, so nothing is generated, cached or saved until you press Apply.

= Does it serve WebP? =

Yes, whenever the browser sends `Accept: image/webp` and PHP can encode WebP (GD with `imagewebp`, or Imagick). Other browsers get JPEG/PNG/GIF. Responses carry `Vary: Accept` so caches and CDNs keep both.

= What about retina / high-DPI screens? =

Every size is offered in `srcset` at 1x, 1.5x and 2x (capped at the original's width). Change the ratios with the `noon_focal_dprs` filter.

= Is it fast? =

The first request for a rendition generates and caches it; every request after that is a cached file. Uploads and focal-point changes are pre-built in the background, and there is a "warm everything" button and a WP-CLI command for existing libraries.

= Does it work with nginx? =

Yes — see Installation for the server block. `.htaccess` is Apache/LiteSpeed only.

= Does it work with a CDN or page cache? =

Yes. URLs are ordinary, cacheable, signed URLs on your uploads path; the `Vary: Accept` header keeps WebP and non-WebP responses apart.

= Does it work with SVG? =

SVG and other non-raster files are served unchanged.

= What happens if I deactivate it? =

WordPress goes back to its generated files. Sizes that were never written to disk (uploads made while the plugin was active) will fall back to the original until you regenerate thumbnails. Uninstalling removes the focal point meta, the cache and the signing secret.

== Screenshots ==

1. Focal point picker in the media library with live previews of every cropped size.
2. Focal point panel in the Image block sidebar.
3. Featured image panel with the focal point picker.
4. Settings → Media status panel.

== Changelog ==

= 1.3.0 =
* "Suggest from faces": in-browser face detection moves the focal point to keep as many faces as possible whole in every cropped size, outlines the faces on the picker and badges each crop preview with how it treats them. Loaded on first use only; `noon_focal_face_detection` filter hides it.
* The signing secret now lives in a network option, mirrored via WP_Filesystem to a protected file in the uploads directory for media.php to read (previously a file at the wp-content root, which WP.org's guidelines disallow). A missing or unwritable secret is no longer an error — images are served unsigned instead of not at all.
* `league/glide` updated to 4.1.0.
* `NOON_FOCAL_CONTENT_DIR` now prefers `WP_CONTENT_DIR` when WordPress is loaded.

= 1.2.1 =
* Text domain is now `focal-point-images-smart-crop` throughout, and editor scripts load their translations.

= 1.2.0 =
* Responsive image sizes: `noon_focal_add_image_size()` gives a size its own `srcset` width ladder, or a focal-cropped box per viewport output as `<picture>`.
* Full-screen focal point editor with real-time previews of every cropped size, in the media library, the featured-image panel and the Image / Media & Text block sidebar.
* `default_focus` filter renamed to `noon_focal_default_focus`.
* Deprecated `noon_get_attachment_image()` / `noon_get_attachment_image_url()` removed — use `wp_get_attachment_image()`.
* Coding-standards and security hardening for the WordPress.org directory.

= 1.1.0 =
* Focal point picker in the block editor (featured image, Image and Media & Text blocks).
* WordPress functions return Glide URLs directly; `srcset` at 1x/1.5x/2x.
* Cache warming and status panel.

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.2.0 =
The `default_focus` filter is now `noon_focal_default_focus`, and the deprecated `noon_get_attachment_image*()` helpers have been removed.

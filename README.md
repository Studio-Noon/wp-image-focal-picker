# Focal Retina Image Generator

Lets editors set a focal point on images (in the media modal, on the block editor's featured image panel, and in the sidebar of Image and Media & Text blocks) — in a full-screen editor with real-time previews of how every cropped size will look, drawn in the browser so nothing is generated or saved until you apply — and serves every image size on demand through [Glide](https://glide.thephpleague.com/): focal-point cropped, retina (`dpr=2`) and WebP when the browser accepts it.

WordPress only writes the `thumbnail` file on upload. Every other size — `wp_get_attachment_image()`, `the_post_thumbnail()`, image blocks, `srcset` — is a signed URL like

```
/wp-content/uploads/2024/01/photo.jpg?w=1024&h=576&fit=crop-30-60&s=<signature>
```

which Apache rewrites to `media.php`. Renditions are cached in `wp-content/cache/noon-images` and purged when the focal point changes or the attachment is deleted.

## Requirements

- PHP 8.0+ with GD (WebP needs `imagewebp`) or Imagick
- Apache `mod_rewrite` — the rule is added to `.htaccess` on activation (or after _Settings → Permalinks → Save_). **On multisite WordPress never writes `.htaccess`**: the plugin is network-activated and shows the block to paste in Network Admin, and again under _Settings → Media → Focal images — status_.
- For nginx, `.htaccess` is ignored; add this to the server config (also printed on the status panel):

  ```nginx
  # http {}
  map "$arg_direct:$arg_w:$arg_h:$arg_s" $noon_focal_glide {
      default 0;
      "~^:[0-9]+:[0-9]+:[a-f0-9]*$" 1;
  }

  # server {}, before any generic static-file location
  location ~* ^/(?:[_0-9a-zA-Z-]+/)?wp-content/uploads/.+\.[a-z0-9]+$ {
      if ($noon_focal_glide) {
          rewrite ^ /wp-content/plugins/noon-focus-crop/media.php last;
      }
  }
  ```

_Settings → Media → Focal images — status_ runs a live signed request against the site and reports whether the rewrite, secret, cache directory and image library are all working.

## Install / deploy

```sh
composer install --no-dev   # league/glide into vendor/ (git-ignored)
npm install && npm run build  # only when changing admin/src
npm run zip                   # optional: ../noon-focus-crop.zip (.distignore lists what is left out)
wp plugin check noon-focus-crop   # Plugin Check, before a WordPress.org release
```

On activation (and self-healing on every admin page load) a random signing secret is generated with `wp_generate_password()`, stored in the `noon_focal_signing_secret` network option, and mirrored via `WP_Filesystem` to `wp-content/uploads/.noon-focal-secret.php` so `media.php` — which runs without WordPress and so has no database access — can read it too. The file opens with `<?php exit; ?>`, so a server that executes it returns nothing, and an `insert_with_markers()` block in `uploads/.htaccess` denies it on Apache/LiteSpeed; `media.php` reads it as text and never includes it. If the mirror is ever lost, reloading an admin page regenerates it from the same stored value, so nothing already cached is invalidated. If it can't be written at all (read-only filesystem, etc.), `media.php` fails closed: every request gets the original file, never an unsigned rendition. `media.php` also refuses to be requested directly (`…/media.php/uploads/…`), so it only ever answers for URLs the web server rewrote to it.

## Using it in templates

Use the normal WordPress functions — the plugin hooks `image_downsize` and `wp_calculate_image_srcset`, so they return focal-cropped Glide URLs with a 1x / 1.5x / 2x `srcset` and native `loading="lazy"`:

```php
the_post_thumbnail( 'hero', [ 'class' => 'hero__img' ] );
echo wp_get_attachment_image( $id, 'large', false, [ 'sizes' => '(min-width: 768px) 50vw, 100vw' ] );
echo wp_get_attachment_image_url( $id, 'medium' );
```

Named sizes come from `add_image_size()` and the core sizes; `crop => true` sizes use the focal point, others are constrained to fit. A plain `[ 400, 300 ]` array is a bounding box (as in core); pass `[ 'w' => 400, 'h' => 300, 'crop' => true ]` for a focal crop at an ad-hoc size.

Image and Media & Text blocks save a static `<img>` in post content; the plugin re-signs those at render time (`wp_content_img_tag`) so they always follow the image's current focal point. The point is per image, not per block — changing it in one place changes every crop of that image.

WebP is negotiated per request from the `Accept` header, and PNG/GIF sources keep their format, so there is nothing to pass for transparency.

### Responsive sizes

`noon_focal_add_image_size()` is `add_image_size()` plus a responsive definition, so a size can carry its own `srcset` (and `<picture>`) rules and every `wp_get_attachment_image()` / `the_post_thumbnail()` / Image block using it gets them automatically. Register in the theme's `after_setup_theme` callback:

```php
// Art direction: a different focal-cropped box per viewport → <picture>.
noon_focal_add_image_size( 'hero', 640, 800, true, [
    'breakpoints' => [
        768  => [ 1280, 720 ],   // viewport min-width (px) => box
        1440 => [ 1920, 900 ],   // a box can also be a registered size name
    ],
] );

// No breakpoints: an automatic width ladder at the size's own aspect ratio → <img srcset>.
noon_focal_add_image_size( 'card', 800, 600, true );

// Or be explicit about the widths and the sizes attribute.
noon_focal_add_image_size( 'teaser', 600, 400, true, [
    'widths' => [ 300, 450, 600 ],
    'sizes'  => '(min-width: 1024px) 33vw, 100vw',
] );

// Attach a definition to a size that already exists (core sizes included).
noon_focal_set_responsive_size( 'large', [ 'sizes' => '(min-width: 768px) 50vw, 100vw' ] );
```

- **With `breakpoints`** the output is `<picture>` with one `<source media="(min-width: …)">` per breakpoint, each offered at 1x / 1.5x / 2x (`noon_focal_dprs`), and the normal `<img>` (the size's own box, with its dpr `srcset`) as the fallback for smaller viewports. A `0` key overrides that base box. Boxes with `crop => true` (the default for arrays here) use the focal point.
- **Without `breakpoints`** the `srcset` lists the size's `widths` — or, when none are given, `noon_focal_auto_widths` (`320 … 1920`, only those below the size's width) plus the size's width — each multiplied by every dpr, at the size's aspect ratio, capped at the original width and at `noon_focal_max_output_width` (2560px). So a 800×600 size on a 2000px original offers 320w … 1600w.
- `sizes` is used when the template passes no `sizes` attr; otherwise WordPress's default `(max-width: Wpx) 100vw, Wpx` applies.
- If a responsive size is opted into warming (`noon_focal_warm_sizes`), the warmer builds exactly what this markup requests: the `<img>`, its `srcset` and every breakpoint `<source>`.
- Since `wp_calculate_image_srcset` only sees `[w, h]`, a ladder size is recognised by its box; two responsive sizes that resolve to the same box are ambiguous (the first registered wins).

For art direction without a registered size, build a `<picture>` from the same functions:

```php
<picture>
  <source media="(min-width: 1024px)" srcset="<?php echo esc_attr( wp_get_attachment_image_srcset( $id, 'hero' ) ); ?>">
  <source media="(min-width: 768px)"  srcset="<?php echo esc_attr( wp_get_attachment_image_srcset( $id, 'large' ) ); ?>">
  <?php echo wp_get_attachment_image( $id, 'medium' ); ?>
</picture>
```

## Suggesting a focal point from faces

Every picker has a **Suggest from faces** button. It runs face detection in the browser ([@vladmandic/face-api](https://github.com/vladmandic/face-api), TinyFaceDetector) and moves the focal point to wherever the most faces stay whole across *every* cropped size — scored per size, so a wide banner and a tall card are both taken into account. Detected faces are outlined on the image, and each crop preview is badged: green when all faces are in, amber when a face is in but its headroom is trimmed, red when a crop cuts through a face. Faces that cannot all fit a size are left out of frame rather than sliced.

The detector and its embedded weights are only fetched on the first click, from the plugin's own `admin/build/` directory; the image never leaves the browser. Nothing is saved until the point is applied as usual.

- `noon_focal_face_detection` — return `false` to hide the button.
- `npm run build` embeds the model weights into the lazy-loaded `admin/build/face-api.js` chunk. No separate `.bin` or `.dat` request is needed; without the detector chunk the button is not shown.

## Cache and expiry

Renditions are built on their first request, cached in `wp-content/cache/noon-images/`, and deleted by a daily WP-Cron pass once nobody has requested them for 14 days (2 days when a CDN is configured). Each request refreshes a rendition's timestamp at most once a day. _Settings → Media → Image cache_ has purge buttons, and `wp noon-focal purge [--network|--expired]` does the same from WP-CLI. If your host disables WP-Cron, make sure `wp cron event run --due-now` runs from a system cron, or the cache never expires.

## Cache warming (opt-in)

Nothing is pre-built by default. Warming every size for every image used to multiply the cache to several times the size of the uploads, mostly with renditions nobody ever requested. To pre-build a size nearly every image is shown at, opt it in:

```php
add_filter( 'noon_focal_warm_sizes', fn() => [ 'card' ] );
```

Opted-in sizes are built in the background when an image is uploaded or its focal point changes, and by `wp noon-focal warm [<id>...] [--force]`. Only the renditions the front end requests for those sizes are built (the `src`, the dpr or width-ladder `srcset`, and any breakpoint `<source>`s), in WebP where PHP can encode it (`noon_focal_warm_formats`). There is no warm button in the admin.

Warming is switched off entirely by `define( 'NOON_FOCAL_DISABLE_WARMING', true );` in `wp-config.php`, by the `noon_focal_warming_enabled` filter, or by configuring a CDN. With a CDN, warming would only fill this server's disk.

## CDN (BunnyCDN)

Put a pull zone in front of the image endpoint and the CDN keeps the renditions. This server's cache then only bridges CDN misses.

1. Create a pull zone whose origin is the site (e.g. `https://example.com`).
2. Enable **Perma-Cache** (renditions kept in Bunny Storage, so each one is rendered here about once).
3. Enable **Vary Cache → WebP support**. `media.php` picks WebP or JPEG/PNG from the `Accept` header; without this, Bunny can send WebP to browsers that cannot show it.
4. Leave **Ignore query strings** off: `w`, `h`, `fit` and `s` are part of the cache key.
5. In `wp-config.php`: `define( 'NOON_FOCAL_CDN_URL', 'https://example.b-cdn.net' );`. On multisite, use the `noon_focal_cdn_url` filter (`$cdn`, `$blog_id`) for per-site zones.

Glide URLs are then built on the CDN host. Signatures cover only the path, so they validate unchanged when Bunny pulls from the origin. A focal point change produces new URLs, so no CDN purge is needed. Replacing a file in place, or deleting an attachment, does not purge the CDN; purge the pull zone if that matters. The status panel on _Settings → Media_ checks that a repeat request is a `CDN-Cache: HIT` and that non-WebP clients are not sent WebP.

## Caching headers

Renditions are sent with `Cache-Control: public, max-age=31536000`; errors are sent with `no-store`. Many hosts add `no-store` to every PHP response, and that includes `media.php`, so browsers and CDNs cache nothing. The plugin handles this for `media.php` only:

- `media.php` drops any `Cache-Control` / `Pragma` / `Expires` PHP set before rendering.
- The plugin's own `.htaccess` (Apache) replaces whatever the server adds, for `media.php` alone. Other PHP files keep the host's headers. It needs `mod_headers` and `AllowOverride` covering `FileInfo` for the plugin directory (the same as the root `.htaccess` needs for the rewrite).
- **nginx** ignores `.htaccess`. Add the headers in the `location` that hands `media.php` to PHP-FPM, e.g. `fastcgi_hide_header Cache-Control; add_header Cache-Control "public, max-age=31536000, immutable" always;` in a dedicated `location = /wp-content/plugins/noon-focus-crop/media.php` block.
- If a proxy in front of the web server (Varnish, a host's nginx) rewrites the header, it has to be fixed there. With BunnyCDN you can instead override the cache time in the pull zone.

The status panel's live request warns when the rendition it fetches is not cacheable.

## Hooks

- `noon_focal_default_focus` — `[ x, y ]` (0–1) used for images without a stored focal point.
- `noon_focal_dprs` — device pixel ratios offered in `srcset`. Default `[ 1, 1.5, 2 ]`.
- `noon_focal_max_output_width` — widest rendition ever produced; wider density steps and ladder widths give way to one step at this width. Default `2560`, `0` for none.
- `noon_focal_auto_widths` — `( int[] $widths, string $size_name )` ladder for responsive sizes registered without `widths`. Default `[ 320, 480, 640, 768, 1024, 1280, 1536, 1920 ]`.
- `noon_focal_responsive_sizes` — `name => [ 'breakpoints', 'widths', 'sizes' ]` map of responsive definitions.
- `noon_focal_warm_sizes` — `( array $sizes, int $attachment_id )` size names / boxes the warmer builds. Default: none.
- `noon_focal_warm_formats` — `( array[] $formats, string $file )` format/quality params each warmed rendition is built in. Default: WebP where supported.
- `noon_focal_warm_variants` — final list of Glide parameter sets the warmer builds.
- `noon_focal_warming_enabled` — `bool`; `false` turns warming off (as does `NOON_FOCAL_DISABLE_WARMING`).
- `noon_focal_cdn_url` — `( string $cdn, int $blog_id )` CDN origin for Glide URLs. Default `NOON_FOCAL_CDN_URL` or none.
- `noon_focal_cache_max_age` — seconds a rendition may go unrequested before it expires. Default 14 days (2 with a CDN); `0` disables expiry.
- `noon_focal_cache_purged` — action fired after an attachment's renditions are purged.
- `noon_focal_preview_sizes` — `[ [ 'label', 'w', 'h' ], … ]` boxes shown as live crop previews under the pickers. Default: every cropped registered size plus responsive breakpoint boxes.
- `noon_focal_enqueue_media_assets` — `( bool $load, string $hook_suffix )`; return `false` to keep the media-modal picker off a given admin screen.
- `noon_focal_face_detection` — `bool`; return `false` to hide "Suggest from faces" in the pickers.

Focal points are stored in attachment meta `noon_focal_point` as `{ x: 0–1, y: 0–1 }` and exposed in the REST API.

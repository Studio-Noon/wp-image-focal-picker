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
      "~^:[0-9]+:[0-9]+:[a-f0-9]+$" 1;
  }

  # server {}, before any generic static-file location
  location ~* ^/(?:[_0-9a-zA-Z-]+/)?wp-content/uploads/.+\.[a-z0-9]+$ {
      if ($noon_focal_glide) {
          rewrite ^ /wp-content/plugins/focal-point-images-smart-crop/media.php last;
      }
  }
  ```

_Settings → Media → Focal images — status_ runs a live signed request against the site and reports whether the rewrite, secret, cache directory and image library are all working.

## Install / deploy

```sh
composer install --no-dev   # league/glide into vendor/ (git-ignored)
npm install && npm run build  # only when changing admin/src
npm run zip                   # optional: ../focal-point-images-smart-crop.zip (.distignore lists what is left out)
wp plugin check focal-point-images-smart-crop   # Plugin Check, before a WordPress.org release
```

On activation a random signing secret is written to `wp-content/noon-image-secret.php`. Keep it out of version control; deleting it just rotates the key (cached pages then fall back to the original files until they refresh). Defining `NOON_IMAGE_SECRET` in `wp-config.php` is _not_ enough on its own, because `media.php` runs without WordPress.

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
- **Without `breakpoints`** the `srcset` lists the size's `widths` — or, when none are given, `noon_focal_auto_widths` (`320 … 1920`, only those below the size's width) plus the size's width — each multiplied by every dpr, at the size's aspect ratio, capped at the original width. So a 800×600 size on a 2000px original offers 320w … 1600w.
- `sizes` is used when the template passes no `sizes` attr; otherwise WordPress's default `(max-width: Wpx) 100vw, Wpx` applies.
- The cache warmer pre-builds every breakpoint box and ladder width.
- Since `wp_calculate_image_srcset` only sees `[w, h]`, a ladder size is recognised by its box; two responsive sizes that resolve to the same box are ambiguous (the first registered wins).

For art direction without a registered size, build a `<picture>` from the same functions:

```php
<picture>
  <source media="(min-width: 1024px)" srcset="<?php echo esc_attr( wp_get_attachment_image_srcset( $id, 'hero' ) ); ?>">
  <source media="(min-width: 768px)"  srcset="<?php echo esc_attr( wp_get_attachment_image_srcset( $id, 'large' ) ); ?>">
  <?php echo wp_get_attachment_image( $id, 'medium' ); ?>
</picture>
```

## Cache warming

Renditions are built on first request. To avoid that hit:

- **Automatic** — every new upload, and every focal point change, queues a WP-Cron job that pre-builds all registered sizes at 1x / 1.5x / 2x in the native format and WebP.
- **Media library** — select images in list view and choose the _Warm image cache_ bulk action.
- **Everything** — _Settings → Media → Image cache → Warm cache for all images_ walks the whole library in 20-second cron batches and shows progress.
- **WP-CLI** — `wp noon-focal warm` (all images) or `wp noon-focal warm 12 34 --force` (rebuild those two).

Already-cached renditions are skipped, so warming is safe to repeat. If your host disables WP-Cron, make sure `wp cron event run --due-now` runs from a system cron.

## Hooks

- `noon_focal_default_focus` — `[ x, y ]` (0–1) used for images without a stored focal point.
- `noon_focal_dprs` — device pixel ratios offered in `srcset` and pre-built by the warmer. Default `[ 1, 1.5, 2 ]`.
- `noon_focal_auto_widths` — `( int[] $widths, string $size_name )` ladder for responsive sizes registered without `widths`. Default `[ 320, 480, 640, 768, 1024, 1280, 1536, 1920 ]`.
- `noon_focal_responsive_sizes` — `name => [ 'breakpoints', 'widths', 'sizes' ]` map of responsive definitions.
- `noon_focal_warm_sizes` — size names / `[w, h]` arrays the warmer builds per attachment. Default: all registered sizes.
- `noon_focal_warm_variants` — final list of Glide parameter sets the warmer builds.
- `noon_focal_cache_purged` — action fired after an attachment's renditions are purged.
- `noon_focal_preview_sizes` — `[ [ 'label', 'w', 'h' ], … ]` boxes shown as live crop previews under the pickers. Default: every cropped registered size plus responsive breakpoint boxes.
- `noon_focal_enqueue_media_assets` — `( bool $load, string $hook_suffix )`; return `false` to keep the media-modal picker off a given admin screen.

Focal points are stored in attachment meta `noon_focal_point` as `{ x: 0–1, y: 0–1 }` and exposed in the REST API.

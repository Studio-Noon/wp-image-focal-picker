# Focal Retina Image Generator

Lets editors set a focal point on images (in the media modal and on the block editor's featured image panel) and serves every image size on demand through [Glide](https://glide.thephpleague.com/): focal-point cropped, retina (`dpr=2`) and WebP when the browser accepts it.

WordPress only writes the `thumbnail` file on upload. Every other size — `wp_get_attachment_image()`, `the_post_thumbnail()`, image blocks, `srcset` — is a signed URL like

```
/wp-content/uploads/2024/01/photo.jpg?w=1024&h=576&fit=crop-30-60&s=<signature>
```

which Apache rewrites to `media.php`. Renditions are cached in `wp-content/cache/noon-images` and purged when the focal point changes or the attachment is deleted.

## Requirements

- PHP 8.0+ with GD (WebP needs `imagewebp`) or Imagick
- Apache `mod_rewrite` — the rule is added to `.htaccess` on activation (or after *Settings → Permalinks → Save*). For nginx, add the equivalent:

  ```nginx
  location ~* ^/wp-content/uploads/.+\.[A-Za-z0-9]+$ {
      if ($args ~* "(^|&)w=\d+(&|$)") { set $glide 1; }
      if ($args ~* "(^|&)s=[a-f0-9]+(&|$)") { set $glide "${glide}1"; }
      if ($args ~* "direct=true") { set $glide 0; }
      if ($glide = 11) { rewrite ^ /wp-content/plugins/noon-focal-retina-image-generator/media.php last; }
  }
  ```

## Install / deploy

```sh
composer install --no-dev   # league/glide into vendor/ (git-ignored)
npm install && npm run build  # only when changing admin/src
npm run zip                   # optional: ../noon-focal-retina-image-generator.zip
```

On activation a random signing secret is written to `wp-content/noon-image-secret.php`. Keep it out of version control; deleting it just rotates the key (cached pages then fall back to the original files until they refresh). Defining `NOON_IMAGE_SECRET` in `wp-config.php` is *not* enough on its own, because `media.php` runs without WordPress.

## Using it in templates

Use the normal WordPress functions — the plugin hooks `image_downsize` and `wp_calculate_image_srcset`, so they return focal-cropped Glide URLs with a 1x / 1.5x / 2x `srcset` and native `loading="lazy"`:

```php
the_post_thumbnail( 'hero', [ 'class' => 'hero__img' ] );
echo wp_get_attachment_image( $id, 'large', false, [ 'sizes' => '(min-width: 768px) 50vw, 100vw' ] );
echo wp_get_attachment_image_url( $id, 'medium' );
```

Named sizes come from `add_image_size()` and the core sizes; `crop => true` sizes use the focal point, others are constrained to fit. WebP is negotiated per request from the `Accept` header, and PNG/GIF sources keep their format, so there is nothing to pass for transparency.

For art direction (a different size *and shape* per breakpoint) build a `<picture>` from the same functions:

```php
<picture>
  <source media="(min-width: 1024px)" srcset="<?php echo esc_attr( wp_get_attachment_image_srcset( $id, 'hero' ) ); ?>">
  <source media="(min-width: 768px)"  srcset="<?php echo esc_attr( wp_get_attachment_image_srcset( $id, 'large' ) ); ?>">
  <?php echo wp_get_attachment_image( $id, 'medium' ); ?>
</picture>
```

`noon_get_attachment_image()` and `noon_get_attachment_image_url()` still work but are deprecated (they raise `_deprecated_function` notices under `WP_DEBUG`).

## Cache warming

Renditions are built on first request. To avoid that hit:

- **Automatic** — every new upload, and every focal point change, queues a WP-Cron job that pre-builds all registered sizes at 1x / 1.5x / 2x in the native format and WebP.
- **Media library** — select images in list view and choose the *Warm image cache* bulk action.
- **Everything** — *Settings → Media → Image cache → Warm cache for all images* walks the whole library in 20-second cron batches and shows progress.
- **WP-CLI** — `wp noon-focal warm` (all images) or `wp noon-focal warm 12 34 --force` (rebuild those two).

Already-cached renditions are skipped, so warming is safe to repeat. If your host disables WP-Cron, make sure `wp cron event run --due-now` runs from a system cron.

## Hooks

- `default_focus` — `[ x, y ]` (0–1) used for images without a stored focal point.
- `noon_focal_dprs` — device pixel ratios offered in `srcset` and pre-built by the warmer. Default `[ 1, 1.5, 2 ]`.
- `noon_focal_warm_sizes` — size names / `[w, h]` arrays the warmer builds per attachment. Default: all registered sizes.
- `noon_focal_warm_variants` — final list of Glide parameter sets the warmer builds.
- `noon_focal_cache_purged` — action fired after an attachment's renditions are purged.
- `noon_focal_enqueue_media_assets` — return `false` to keep the media-modal picker off a given admin screen (defaults to off on `?page=event-wizard`).

Focal points are stored in attachment meta `noon_focal_point` as `{ x: 0–1, y: 0–1 }` and exposed in the REST API.

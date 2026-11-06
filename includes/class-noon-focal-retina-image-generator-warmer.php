<?php
/**
 * Optionally pre-builds Glide renditions for a short, opt-in list of sizes so
 * the first visitor doesn't wait for those to render.
 *
 * Nothing is warmed by default: every rendition is otherwise built on its
 * first request and expires when unused (see the Cache class). A theme opts
 * sizes in with the `noon_focal_warm_sizes` filter; those are then built in
 * the background when an image is uploaded or its focal point changes, and by
 * `wp noon-focal warm` from WP-CLI. Only the renditions the front end actually
 * requests for those sizes are built (noon_focal_size_renditions()), in one
 * format (WebP where supported).
 *
 * Warming is off entirely when NOON_FOCAL_DISABLE_WARMING is true, when a CDN
 * is configured (it would only fill this server's disk, not the CDN), or when
 * `noon_focal_warming_enabled` returns false.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use League\Glide\ServerFactory;

class Noon_Focal_Retina_Image_Generator_Warmer {

	const CRON_ONE = 'noon_focal_warm_attachment';

	/** Removed "warm everything" batch run (before 1.4.0): its hook and progress option. */
	const LEGACY_CRON_BATCH = 'noon_focal_warm_batch';
	const LEGACY_OPTION     = 'noon_focal_warm_progress';

	public function register() {

		add_action( self::CRON_ONE, array( $this, 'warm' ) );

		add_filter( 'wp_generate_attachment_metadata', array( $this, 'on_upload' ), 20, 2 );
		add_action( 'noon_focal_cache_purged', array( $this, 'schedule' ) );

		// A batch queued before the upgrade fires once more: tidy up instead of warming.
		add_action( self::LEGACY_CRON_BATCH, array( __CLASS__, 'remove_legacy_batch' ) );

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::add_command( 'noon-focal warm', array( $this, 'cli' ) );
		}

	}

	/**
	 * Whether anything may be pre-built. Checked when used rather than at
	 * register() time, because themes add their filters after plugins load.
	 */
	public static function enabled() {

		$enabled = ! ( defined( 'NOON_FOCAL_DISABLE_WARMING' ) && NOON_FOCAL_DISABLE_WARMING ) && '' === noon_focal_cdn_url();

		/**
		 * Whether the cache warmer may pre-build renditions. Defaults to true
		 * unless NOON_FOCAL_DISABLE_WARMING is set or a CDN URL is configured.
		 *
		 * @param bool $enabled
		 */
		return (bool) apply_filters( 'noon_focal_warming_enabled', $enabled );

	}

	/**
	 * Sizes to pre-build for an attachment: names (responsive ones include
	 * their breakpoints / ladder) or [w, h] / ['w' =>, 'h' =>, 'crop' =>] boxes.
	 *
	 * @param int $attachment_id 0 for the general list (settings screen).
	 * @return array
	 */
	public static function sizes( $attachment_id = 0 ) {

		/**
		 * Sizes the warmer pre-builds. Empty by default: everything is built on
		 * first request. Opt in only sizes nearly every image is shown at (e.g.
		 * listing cards); each one adds several renditions per image.
		 *
		 * @param array $sizes         Size names or boxes.
		 * @param int   $attachment_id
		 */
		$sizes = apply_filters( 'noon_focal_warm_sizes', array(), (int) $attachment_id );

		return array_values( array_filter( (array) $sizes ) );

	}

	/**
	 * Format/quality params to build each rendition in. One by default: WebP
	 * when PHP can encode it (nearly every browser asks for it), otherwise the
	 * native format. Other formats are still rendered on demand.
	 *
	 * @param string $file Upload path, for its extension.
	 * @return array[]
	 */
	public static function formats( $file ) {

		$formats = apply_filters( 'noon_focal_warm_formats', array( noon_focal_default_params( $file, true ) ), $file );

		return array_values( array_unique( array_filter( (array) $formats, 'is_array' ), SORT_REGULAR ) );

	}

	/* ---------------------------------------------------------------------
	 * Warming
	 * ------------------------------------------------------------------ */

	/**
	 * The renditions the front end requests for each opted-in size, in each
	 * warmed format.
	 *
	 * @return array[] Lists of Glide params.
	 */
	public function variants( $attachment_id ) {

		$file = noon_focal_source_path( $attachment_id );

		if ( ! $file ) {
			return array();
		}

		$formats  = self::formats( $file );
		$variants = array();

		foreach ( self::sizes( $attachment_id ) as $size ) {
			foreach ( noon_focal_size_renditions( $attachment_id, $size ) as $params ) {
				foreach ( $formats as $format ) {
					$variants[] = array_merge( $format, $params );
				}
			}
		}

		$variants = array_values( array_unique( $variants, SORT_REGULAR ) );

		return apply_filters( 'noon_focal_warm_variants', $variants, $attachment_id );

	}

	/**
	 * Build every variant for one attachment. Glide skips renditions that are
	 * already cached, so this is cheap to repeat.
	 *
	 * @return int Number of variants processed.
	 */
	public function warm( $attachment_id ) {

		$attachment_id = (int) $attachment_id;

		if ( ! self::enabled() || ! wp_attachment_is_image( $attachment_id ) ) {
			return 0;
		}

		$file = noon_focal_source_path( $attachment_id );

		if ( ! $file || ! noon_focal_is_raster( $file ) ) {
			return 0;
		}

		$variants = $this->variants( $attachment_id );

		if ( ! $variants ) {
			return 0;
		}

		$server = ServerFactory::create( array(
			'source'         => NOON_FOCAL_UPLOADS_DIR,
			'cache'          => NOON_FOCAL_CACHE_DIR,
			'max_image_size' => 4000 * 4000,
		) );

		$count = 0;

		foreach ( $variants as $params ) {
			try {
				$server->makeImage( $file, $params );
				$count++;
			} catch ( Throwable $e ) {
				wp_trigger_error( __METHOD__, sprintf( 'could not warm #%d (%s): %s', $attachment_id, http_build_query( $params ), $e->getMessage() ) );
			}
		}

		return $count;

	}

	/**
	 * Queue a background warm, unless warming is off or no sizes are opted in.
	 */
	public function schedule( $attachment_id ) {

		$attachment_id = (int) $attachment_id;

		if ( ! self::enabled() || ( ! self::sizes( $attachment_id ) && ! has_filter( 'noon_focal_warm_variants' ) ) ) {
			return;
		}

		if ( ! wp_next_scheduled( self::CRON_ONE, array( $attachment_id ) ) ) {
			wp_schedule_single_event( time(), self::CRON_ONE, array( $attachment_id ) );
		}

	}

	public function on_upload( $metadata, $attachment_id ) {
		if ( wp_attachment_is_image( $attachment_id ) ) {
			$this->schedule( $attachment_id );
		}
		return $metadata;
	}

	public static function remove_legacy_batch() {
		delete_option( self::LEGACY_OPTION );
	}

	/**
	 * Image attachment IDs after a cursor, in ID order.
	 */
	private function image_ids( $after_id, $limit ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off WP-CLI walk; nothing to cache.
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare(
			"SELECT ID FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_mime_type LIKE %s AND ID > %d ORDER BY ID ASC LIMIT %d",
			$wpdb->esc_like( 'image/' ) . '%',
			$after_id,
			$limit
		) ) );
	}

	/* ---------------------------------------------------------------------
	 * WP-CLI
	 * ------------------------------------------------------------------ */

	/**
	 * Pre-build renditions for the sizes opted in with `noon_focal_warm_sizes`.
	 *
	 * ## OPTIONS
	 *
	 * [<id>...]
	 * : Attachment IDs. Defaults to every image.
	 *
	 * [--force]
	 * : Delete existing renditions first.
	 *
	 * ## EXAMPLES
	 *
	 *     wp noon-focal warm
	 *     wp noon-focal warm 12 34 --force
	 */
	public function cli( $args, $assoc_args ) {

		if ( ! self::enabled() ) {
			WP_CLI::warning( 'Warming is disabled (NOON_FOCAL_DISABLE_WARMING, a CDN URL, or the noon_focal_warming_enabled filter). Nothing to do.' );
			return;
		}

		if ( ! self::sizes() && ! has_filter( 'noon_focal_warm_variants' ) ) {
			WP_CLI::warning( 'No sizes are opted in with the noon_focal_warm_sizes filter. Nothing to do.' );
			return;
		}

		$ids = $args ? array_map( 'intval', $args ) : $this->image_ids( 0, PHP_INT_MAX );
		$bar = WP_CLI\Utils\make_progress_bar( 'Warming', count( $ids ) );
		$n   = 0;

		foreach ( $ids as $id ) {
			if ( ! empty( $assoc_args['force'] ) ) {
				Noon_Focal_Retina_Image_Generator_Admin::delete_cache( $id );
			}
			$n += $this->warm( $id );
			$bar->tick();
		}

		$bar->finish();
		WP_CLI::success( sprintf( '%d renditions across %d images.', $n, count( $ids ) ) );

	}

}

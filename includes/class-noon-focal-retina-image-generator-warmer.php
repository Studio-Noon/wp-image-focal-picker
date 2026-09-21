<?php
/**
 * Pre-builds Glide renditions so the first visitor never waits for image
 * generation.
 *
 * - New uploads and focal point changes queue a WP-Cron event for that image.
 * - "Warm image cache" bulk action in the media library queues selected images.
 * - Settings → Media has a button that walks every image in timed cron batches.
 * - `wp noon-focal warm` does the same synchronously from WP-CLI.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

use League\Glide\ServerFactory;

class Noon_Focal_Retina_Image_Generator_Warmer {

	const CRON_ONE      = 'noon_focal_warm_attachment';
	const CRON_BATCH    = 'noon_focal_warm_batch';
	const OPTION        = 'noon_focal_warm_progress';
	const ADMIN_ACTION  = 'noon_focal_warm_all';
	const BULK_ACTION   = 'noon_focal_warm';
	const BATCH_SECONDS = 20;

	public function register() {

		add_action( self::CRON_ONE, array( $this, 'warm' ) );
		add_action( self::CRON_BATCH, array( $this, 'run_batch' ) );

		add_filter( 'wp_generate_attachment_metadata', array( $this, 'on_upload' ), 20, 2 );
		add_action( 'noon_focal_cache_purged', array( $this, 'schedule' ) );

		add_filter( 'bulk_actions-upload', array( $this, 'bulk_action' ) );
		add_filter( 'handle_bulk_actions-upload', array( $this, 'handle_bulk_action' ), 10, 3 );

		add_action( 'admin_init', array( $this, 'settings_section' ) );
		add_action( 'admin_post_' . self::ADMIN_ACTION, array( $this, 'handle_warm_all' ) );
		add_action( 'admin_notices', array( $this, 'notices' ) );

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::add_command( 'noon-focal warm', array( $this, 'cli' ) );
		}

	}

	/* ---------------------------------------------------------------------
	 * Warming
	 * ------------------------------------------------------------------ */

	/**
	 * Every rendition the front end can ask for: each registered size (other
	 * than the thumbnail file) × each dpr × native format and WebP.
	 *
	 * @return array[] Lists of Glide params.
	 */
	public function variants( $attachment_id ) {

		$file = noon_focal_source_path( $attachment_id );
		$meta = wp_get_attachment_metadata( $attachment_id );
		$max  = (int) ( $meta['width'] ?? 0 );

		if ( ! $file ) {
			return array();
		}

		$sizes = array_keys( wp_get_registered_image_subsizes() );

		if ( ! empty( $meta['sizes']['thumbnail'] ) ) {
			$sizes = array_diff( $sizes, array( 'thumbnail' ) );
		}

		/**
		 * Sizes to pre-build for an attachment. Add [w, h] arrays for any ad-hoc
		 * sizes your templates request.
		 */
		$sizes = apply_filters( 'noon_focal_warm_sizes', $sizes, $attachment_id );

		// Responsive sizes: breakpoint boxes go through the dpr loop like any size;
		// width-ladder candidates are already at their final width so get formats only.
		$fixed = array();

		foreach ( noon_focal_responsive_sizes() as $name => $config ) {
			foreach ( $config['breakpoints'] as $min_width => $box ) {
				if ( $min_width > 0 ) {
					$sizes[] = $box;
				}
			}
			foreach ( noon_focal_responsive_candidates( $attachment_id, $name ) as $box ) {
				$fixed[] = $box + array( 'crop' => true );
			}
		}

		$formats = array( noon_focal_default_params( $file, false ) );
		if ( noon_focal_webp_supported() ) {
			$formats[] = noon_focal_default_params( $file, true );
		}
		$formats = array_unique( $formats, SORT_REGULAR );

		$variants = array();

		foreach ( $sizes as $size ) {

			$params = noon_focal_image_params( $attachment_id, $size );

			if ( ! $params ) {
				continue;
			}

			foreach ( Noon_Focal_Retina_Image_Generator_Admin::dprs() as $dpr ) {

				if ( $max > 0 && round( $params['w'] * $dpr ) > $max ) {
					continue;
				}

				$with_dpr = $params;
				if ( 1 != $dpr ) {
					$with_dpr['dpr'] = $dpr;
				}

				foreach ( $formats as $format ) {
					$variants[] = array_merge( $format, $with_dpr );
				}

			}

		}

		foreach ( $fixed as $box ) {

			$params = noon_focal_image_params( $attachment_id, $box );

			if ( ! $params ) {
				continue;
			}

			foreach ( $formats as $format ) {
				$variants[] = array_merge( $format, $params );
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

		if ( ! wp_attachment_is_image( $attachment_id ) ) {
			return 0;
		}

		$file = noon_focal_source_path( $attachment_id );

		if ( ! $file || ! noon_focal_is_raster( $file ) ) {
			return 0;
		}

		$server = ServerFactory::create( array(
			'source'         => NOON_FOCAL_UPLOADS_DIR,
			'cache'          => NOON_FOCAL_CACHE_DIR,
			'max_image_size' => 4000 * 4000,
		) );

		$count = 0;

		foreach ( $this->variants( $attachment_id ) as $params ) {
			try {
				$server->makeImage( $file, $params );
				$count++;
			} catch ( Throwable $e ) {
				wp_trigger_error( __METHOD__, sprintf( 'could not warm #%d (%s): %s', $attachment_id, http_build_query( $params ), $e->getMessage() ) );
			}
		}

		return $count;

	}

	public function schedule( $attachment_id ) {
		if ( ! wp_next_scheduled( self::CRON_ONE, array( (int) $attachment_id ) ) ) {
			wp_schedule_single_event( time(), self::CRON_ONE, array( (int) $attachment_id ) );
		}
	}

	public function on_upload( $metadata, $attachment_id ) {
		if ( wp_attachment_is_image( $attachment_id ) ) {
			$this->schedule( $attachment_id );
		}
		return $metadata;
	}

	/* ---------------------------------------------------------------------
	 * Warm everything, in cron batches
	 * ------------------------------------------------------------------ */

	public function start_all() {

		update_option( self::OPTION, array(
			'last_id' => 0,
			'done'    => 0,
			'total'   => $this->count_images(),
			'started' => time(),
		), false );

		wp_clear_scheduled_hook( self::CRON_BATCH );
		wp_schedule_single_event( time(), self::CRON_BATCH );

	}

	/**
	 * Warm images in ID order until the time budget runs out, then reschedule.
	 */
	public function run_batch() {

		$progress = get_option( self::OPTION );

		if ( ! is_array( $progress ) ) {
			return;
		}

		$started = microtime( true );
		$ids     = $this->image_ids( $progress['last_id'], 50 );

		foreach ( $ids as $id ) {

			$this->warm( $id );
			$progress['last_id'] = $id;
			$progress['done']++;
			update_option( self::OPTION, $progress, false );

			if ( microtime( true ) - $started > self::BATCH_SECONDS ) {
				break;
			}

		}

		if ( count( $ids ) && $this->image_ids( $progress['last_id'], 1 ) ) {
			wp_schedule_single_event( time(), self::CRON_BATCH );
		} else {
			$progress['finished'] = time();
			update_option( self::OPTION, $progress, false );
		}

	}

	/**
	 * Next batch of image attachment IDs after a cursor. A keyset query rather
	 * than WP_Query with an offset, so a library that changes while the cron
	 * batches run is neither skipped over nor re-walked.
	 */
	private function image_ids( $after_id, $limit ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off cursor walk from a cron batch; nothing to cache.
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare(
			"SELECT ID FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_mime_type LIKE %s AND ID > %d ORDER BY ID ASC LIMIT %d",
			$wpdb->esc_like( 'image/' ) . '%',
			$after_id,
			$limit
		) ) );
	}

	private function count_images() {
		return (int) array_sum( (array) wp_count_attachments( 'image' ) );
	}

	/* ---------------------------------------------------------------------
	 * Admin UI
	 * ------------------------------------------------------------------ */

	public function bulk_action( $actions ) {
		$actions[ self::BULK_ACTION ] = __( 'Warm image cache', 'focal-point-images-smart-crop' );
		return $actions;
	}

	public function handle_bulk_action( $redirect, $action, $ids ) {

		if ( self::BULK_ACTION !== $action ) {
			return $redirect;
		}

		$queued = 0;

		foreach ( $ids as $id ) {
			if ( wp_attachment_is_image( $id ) ) {
				$this->schedule( $id );
				$queued++;
			}
		}

		return add_query_arg( 'noon_focal_warmed', $queued, $redirect );

	}

	public function settings_section() {

		add_settings_section(
			'noon_focal_cache',
			__( 'Image cache', 'focal-point-images-smart-crop' ),
			array( $this, 'render_settings_section' ),
			'media'
		);

	}

	public function render_settings_section() {

		$progress = get_option( self::OPTION );
		$running  = is_array( $progress ) && empty( $progress['finished'] );

		if ( is_array( $progress ) ) {
			printf(
				'<p>%s</p>',
				$running
					/* translators: 1: images done, 2: total images */
					? sprintf( esc_html__( 'Warming in progress: %1$d of %2$d images done.', 'focal-point-images-smart-crop' ), (int) $progress['done'], (int) $progress['total'] )
					/* translators: 1: human-readable time span, 2: number of images */
					: sprintf( esc_html__( 'Last run finished %1$s ago (%2$d images).', 'focal-point-images-smart-crop' ), esc_html( human_time_diff( (int) $progress['finished'] ) ), (int) $progress['done'] )
			);
		}

		// A link rather than a form: this section renders inside the Media settings form.
		printf(
			'<p><a class="button" href="%s">%s</a></p><p class="description">%s</p>',
			esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=' . self::ADMIN_ACTION ), self::ADMIN_ACTION ) ),
			$running
				? esc_html__( 'Restart warming', 'focal-point-images-smart-crop' )
				: esc_html__( 'Warm cache for all images', 'focal-point-images-smart-crop' ),
			esc_html__( 'Pre-builds every registered size (1x, 1.5x, 2x, native and WebP) for every image in the background via WP-Cron. Already-cached renditions are skipped.', 'focal-point-images-smart-crop' )
		);

	}

	public function handle_warm_all() {

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'focal-point-images-smart-crop' ) );
		}

		check_admin_referer( self::ADMIN_ACTION );

		$this->start_all();

		wp_safe_redirect( add_query_arg( 'noon_focal_warm_started', '1', admin_url( 'options-media.php' ) ) );
		exit;

	}

	/**
	 * Success notices after the bulk action / "warm all" redirects. The flags
	 * only choose a message, so they are read without a nonce.
	 */
	public function notices() {

		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		$warmed  = isset( $_GET['noon_focal_warmed'] ) ? absint( wp_unslash( $_GET['noon_focal_warmed'] ) ) : 0;
		$started = isset( $_GET['noon_focal_warm_started'] );
		// phpcs:enable

		if ( $warmed ) {
			printf(
				'<div class="notice notice-success is-dismissible"><p>%s</p></div>',
				esc_html( sprintf(
					/* translators: %d: number of images */
					_n( '%d image queued for cache warming.', '%d images queued for cache warming.', $warmed, 'focal-point-images-smart-crop' ),
					$warmed
				) )
			);
		}

		if ( $started ) {
			printf(
				'<div class="notice notice-success is-dismissible"><p>%s</p></div>',
				esc_html__( 'Cache warming started. It runs in the background; reload this page to see progress.', 'focal-point-images-smart-crop' )
			);
		}

	}

	/* ---------------------------------------------------------------------
	 * WP-CLI
	 * ------------------------------------------------------------------ */

	/**
	 * Pre-build image renditions.
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

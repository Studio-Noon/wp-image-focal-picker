<?php
/**
 * Keeps the Glide cache from growing forever.
 *
 * - "Purge" buttons on Settings → Media: this site's renditions, or (super
 *   admins on multisite) every site's.
 * - A daily WP-Cron job deletes renditions nobody has requested for 14 days
 *   (2 with a CDN in front, which keeps its own copies).
 *   media.php touches a rendition when it serves it, so the file's mtime is
 *   its last use (atime is unreliable on noatime mounts).
 * - `wp noon-focal purge` does the same from WP-CLI.
 *
 * Glide groups renditions by source path, so a sub-site's live under
 * CACHE_DIR/sites/{id}/ and the main site's are everything except sites/.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Noon_Focal_Retina_Image_Generator_Cache {

	const CRON_PRUNE     = 'noon_focal_prune_cache';
	const CRON_CONTINUE  = 'noon_focal_prune_cache_continue';
	const OPTION_CURSOR  = 'noon_focal_prune_cursor';
	const OPTION_LAST    = 'noon_focal_prune_last';
	const ACTION_SITE    = 'noon_focal_purge';
	const ACTION_NETWORK = 'noon_focal_purge_network';
	const BATCH_SECONDS  = 20;

	public function register() {

		add_action( self::CRON_PRUNE, array( $this, 'cron_prune' ) );
		add_action( self::CRON_CONTINUE, array( $this, 'cron_prune' ) );
		add_action( 'admin_init', array( $this, 'schedule' ) );

		add_action( 'admin_init', array( $this, 'settings_section' ) );
		add_action( 'noon_focal_cache_section', array( $this, 'render_buttons' ) );
		add_action( 'admin_post_' . self::ACTION_SITE, array( $this, 'handle_purge' ) );
		add_action( 'admin_post_' . self::ACTION_NETWORK, array( $this, 'handle_purge' ) );
		add_action( 'admin_notices', array( $this, 'notices' ) );

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::add_command( 'noon-focal purge', array( $this, 'cli' ) );
		}

	}

	/**
	 * Seconds a rendition may go unrequested before the daily prune deletes it.
	 * 0 disables pruning.
	 */
	public static function max_age() {
		// With a CDN in front this cache only bridges CDN misses.
		$default = '' !== noon_focal_cdn_url() ? 2 * DAY_IN_SECONDS : 14 * DAY_IN_SECONDS;
		return (int) apply_filters( 'noon_focal_cache_max_age', $default );
	}

	/**
	 * When the last full prune pass finished, and how many files it deleted.
	 *
	 * time is 0 until a pass has finished; running is true while a pass is split
	 * across cron events.
	 *
	 * @return array{time: int, deleted: int, running: bool}|null
	 */
	public static function last_prune() {
		$last = get_site_option( self::OPTION_LAST );
		return is_array( $last ) ? array(
			'time'    => (int) ( $last['time'] ?? 0 ),
			'deleted' => (int) ( $last['deleted'] ?? 0 ),
			'running' => ! empty( $last['running'] ),
		) : null;
	}

	/**
	 * One network-wide prune, scheduled from the main site only.
	 */
	public function schedule() {
		if ( is_main_site() && ! wp_next_scheduled( self::CRON_PRUNE ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CRON_PRUNE );
		}
	}

	/* ---------------------------------------------------------------------
	 * Purging
	 * ------------------------------------------------------------------ */

	/**
	 * Cache directories holding this site's renditions.
	 *
	 * @return string[]
	 */
	public static function site_dirs() {

		$cache   = untrailingslashit( wp_normalize_path( NOON_FOCAL_CACHE_DIR ) );
		$uploads = trailingslashit( wp_normalize_path( NOON_FOCAL_UPLOADS_DIR ) );
		$basedir = trailingslashit( wp_normalize_path( wp_get_upload_dir()['basedir'] ) );

		// Uploads outside NOON_FOCAL_UPLOADS_DIR are never served through Glide.
		if ( 0 !== strpos( $basedir, $uploads ) || ! is_dir( $cache ) ) {
			return array();
		}

		$prefix = untrailingslashit( substr( $basedir, strlen( $uploads ) ) );

		if ( '' !== $prefix ) {
			return is_dir( $cache . '/' . $prefix ) ? array( $cache . '/' . $prefix ) : array();
		}

		// Main site: every top-level folder except the sub-sites' one.
		$dirs = array();

		foreach ( (array) scandir( $cache ) as $entry ) {
			if ( '.' === $entry || '..' === $entry || ( is_multisite() && 'sites' === $entry ) ) {
				continue;
			}
			$dirs[] = $cache . '/' . $entry;
		}

		return $dirs;

	}

	public static function purge_site() {

		foreach ( self::site_dirs() as $dir ) {
			self::delete_tree( $dir );
		}

		/**
		 * Fires after a whole-cache purge.
		 *
		 * @param string $scope 'site' or 'network'.
		 */
		do_action( 'noon_focal_cache_purged_all', 'site' );

	}

	public static function purge_network() {

		if ( is_dir( NOON_FOCAL_CACHE_DIR ) ) {
			self::delete_tree( NOON_FOCAL_CACHE_DIR, false );
		}

		delete_site_option( self::OPTION_CURSOR );

		/** This action is documented in purge_site(). */
		do_action( 'noon_focal_cache_purged_all', 'network' );

	}

	/**
	 * Delete a file or directory recursively. Plain filesystem calls rather
	 * than WP_Filesystem, which may want credentials during cron.
	 *
	 * @param bool $remove_root Also remove $path itself.
	 */
	private static function delete_tree( $path, $remove_root = true ) {

		if ( is_file( $path ) || is_link( $path ) ) {
			wp_delete_file( $path );
			return;
		}

		if ( ! is_dir( $path ) ) {
			return;
		}

		try {
			$iterator = new RecursiveIteratorIterator(
				new RecursiveDirectoryIterator( $path, FilesystemIterator::SKIP_DOTS ),
				RecursiveIteratorIterator::CHILD_FIRST
			);
			foreach ( $iterator as $item ) {
				if ( $item->isDir() && ! $item->isLink() ) {
					@rmdir( $item->getPathname() ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir, WordPress.PHP.NoSilencedErrors.Discouraged -- see method doc; a concurrent render may have refilled it.
				} else {
					wp_delete_file( $item->getPathname() );
				}
			}
		} catch ( Exception $e ) {
			// Unreadable subdirectory; delete what we can.
		}

		if ( $remove_root ) {
			@rmdir( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir, WordPress.PHP.NoSilencedErrors.Discouraged -- as above.
		}

	}

	/* ---------------------------------------------------------------------
	 * Expiry
	 * ------------------------------------------------------------------ */

	/**
	 * Cron entry point: WP-Cron calls argument-less hooks with '', which
	 * prune() would read as "no time budget".
	 */
	public function cron_prune() {
		$this->prune( self::BATCH_SECONDS );
	}

	/**
	 * Delete renditions not requested within max_age(), then empty folders.
	 * Works through the cache one top-level folder (or sites/{id}) at a time
	 * and hands over to a follow-up event when the time budget runs out.
	 *
	 * @param int $budget Seconds before handing over; 0 for no limit (WP-CLI).
	 * @return int Files deleted.
	 */
	public function prune( $budget = self::BATCH_SECONDS ) {

		$max_age = self::max_age();

		if ( $max_age <= 0 || ! is_dir( NOON_FOCAL_CACHE_DIR ) ) {
			return 0;
		}

		$started = microtime( true );
		$cutoff  = time() - $max_age;
		$cursor  = (string) get_site_option( self::OPTION_CURSOR, '' );
		$deleted = 0;
		$last    = self::last_prune();

		// A pass split across cron events adds up its deletions.
		$carried = ( '' !== $cursor && $last && ! empty( $last['running'] ) ) ? $last['deleted'] : 0;

		foreach ( $this->prune_units() as $unit ) {

			if ( '' !== $cursor && strcmp( $unit, $cursor ) <= 0 ) {
				continue;
			}

			$deleted += $this->prune_dir( $unit, $cutoff );
			update_site_option( self::OPTION_CURSOR, $unit );

			if ( $budget && microtime( true ) - $started > $budget ) {
				update_site_option( self::OPTION_LAST, array( 'time' => (int) ( $last['time'] ?? 0 ), 'deleted' => $carried + $deleted, 'running' => true ) );
				wp_schedule_single_event( time() + MINUTE_IN_SECONDS, self::CRON_CONTINUE );
				return $deleted;
			}

		}

		delete_site_option( self::OPTION_CURSOR );
		update_site_option( self::OPTION_LAST, array( 'time' => time(), 'deleted' => $carried + $deleted ) );

		return $deleted;

	}

	/**
	 * Top-level cache folders, with sites/ split per site, in a stable order
	 * so the cursor can resume.
	 *
	 * @return string[]
	 */
	private function prune_units() {

		$cache = untrailingslashit( wp_normalize_path( NOON_FOCAL_CACHE_DIR ) );
		$units = array();

		foreach ( (array) scandir( $cache ) as $entry ) {
			if ( '.' === $entry || '..' === $entry ) {
				continue;
			}
			if ( 'sites' === $entry && is_dir( $cache . '/sites' ) ) {
				foreach ( (array) scandir( $cache . '/sites' ) as $site ) {
					if ( '.' !== $site && '..' !== $site ) {
						$units[] = $cache . '/sites/' . $site;
					}
				}
				continue;
			}
			$units[] = $cache . '/' . $entry;
		}

		sort( $units, SORT_STRING );

		return $units;

	}

	private function prune_dir( $path, $cutoff ) {

		if ( is_file( $path ) ) {
			if ( filemtime( $path ) < $cutoff ) {
				wp_delete_file( $path );
				return 1;
			}
			return 0;
		}

		$deleted = 0;

		try {
			$iterator = new RecursiveIteratorIterator(
				new RecursiveDirectoryIterator( $path, FilesystemIterator::SKIP_DOTS ),
				RecursiveIteratorIterator::CHILD_FIRST
			);
			foreach ( $iterator as $item ) {
				if ( $item->isDir() ) {
					// Fails harmlessly unless the folder is now empty.
					@rmdir( $item->getPathname() ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir, WordPress.PHP.NoSilencedErrors.Discouraged -- non-empty folders are expected.
				} elseif ( $item->getMTime() < $cutoff ) {
					wp_delete_file( $item->getPathname() );
					$deleted++;
				}
			}
		} catch ( Exception $e ) {
			// Unreadable subdirectory; carry on with the next unit.
		}

		@rmdir( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir, WordPress.PHP.NoSilencedErrors.Discouraged -- as above.

		return $deleted;

	}

	/* ---------------------------------------------------------------------
	 * Admin UI
	 * ------------------------------------------------------------------ */

	public function settings_section() {

		add_settings_section(
			'noon_focal_cache',
			__( 'Image cache', 'noon-focus-crop' ),
			array( $this, 'render_section' ),
			'media'
		);

	}

	public function render_section() {

		$sizes = Noon_Focal_Retina_Image_Generator_Warmer::sizes();

		if ( Noon_Focal_Retina_Image_Generator_Warmer::enabled() && $sizes ) {

			$names = array_map( function ( $size ) {
				$box = is_array( $size ) ? noon_focal_resolve_size( $size ) : null;
				return $box ? $box['w'] . '×' . $box['h'] : (string) $size;
			}, $sizes );

			printf(
				'<p>%s</p>',
				/* translators: %s: comma-separated size names */
				esc_html( sprintf( __( 'Pre-built in the background when an image is uploaded or its focal point changes: %s. Every other rendition is created the first time it is requested.', 'noon-focus-crop' ), implode( ', ', $names ) ) )
			);

		} else {

			printf(
				'<p>%s</p>',
				esc_html__( 'Renditions are created the first time they are requested, then served from the cache.', 'noon-focus-crop' )
			);

		}

		/**
		 * Fires at the end of the "Image cache" section on Settings → Media.
		 */
		do_action( 'noon_focal_cache_section' );

	}

	/**
	 * Purge buttons in the "Image cache" section on Settings → Media.
	 * Links rather than forms: the section renders inside the Media form.
	 */
	public function render_buttons() {

		$confirm = esc_js( __( 'Delete the cached images? They are rebuilt the next time they are requested.', 'noon-focus-crop' ) );

		echo '<p>';

		printf(
			'<a class="button" href="%s" onclick="return confirm(\'%s\')">%s</a>',
			esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=' . self::ACTION_SITE ), self::ACTION_SITE ) ),
			esc_attr( $confirm ),
			is_multisite()
				? esc_html__( "Purge this site's image cache", 'noon-focus-crop' )
				: esc_html__( 'Purge image cache', 'noon-focus-crop' )
		);

		if ( is_multisite() && current_user_can( 'manage_network_options' ) ) {
			printf(
				' <a class="button" href="%s" onclick="return confirm(\'%s\')">%s</a>',
				esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=' . self::ACTION_NETWORK ), self::ACTION_NETWORK ) ),
				esc_attr( $confirm ),
				esc_html__( 'Purge image cache for all sites', 'noon-focus-crop' )
			);
		}

		echo '</p>';

		$max_age = self::max_age();

		printf(
			'<p class="description">%s</p>',
			$max_age > 0
				/* translators: %d: number of days */
				? esc_html( sprintf( _n( 'Cached images not requested for %d day are deleted automatically.', 'Cached images not requested for %d days are deleted automatically.', (int) ceil( $max_age / DAY_IN_SECONDS ), 'noon-focus-crop' ), (int) ceil( $max_age / DAY_IN_SECONDS ) ) )
				: esc_html__( 'Automatic expiry of unused cached images is disabled.', 'noon-focus-crop' )
		);

	}

	public function handle_purge() {

		$network = 'admin_post_' . self::ACTION_NETWORK === current_action();
		$action  = $network ? self::ACTION_NETWORK : self::ACTION_SITE;

		if ( ! current_user_can( $network ? 'manage_network_options' : 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'noon-focus-crop' ) );
		}

		check_admin_referer( $action );

		if ( $network ) {
			self::purge_network();
		} else {
			self::purge_site();
		}

		wp_safe_redirect( add_query_arg( 'noon_focal_purged', $network ? 'network' : 'site', admin_url( 'options-media.php' ) ) );
		exit;

	}

	/**
	 * Success notice after a purge redirect. The flag only chooses a message,
	 * so it is read without a nonce.
	 */
	public function notices() {

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$purged = isset( $_GET['noon_focal_purged'] ) ? sanitize_key( wp_unslash( $_GET['noon_focal_purged'] ) ) : '';

		if ( ! in_array( $purged, array( 'site', 'network' ), true ) ) {
			return;
		}

		printf(
			'<div class="notice notice-success is-dismissible"><p>%s</p></div>',
			'network' === $purged
				? esc_html__( 'Image cache purged for all sites.', 'noon-focus-crop' )
				: esc_html__( 'Image cache purged.', 'noon-focus-crop' )
		);

	}

	/* ---------------------------------------------------------------------
	 * WP-CLI
	 * ------------------------------------------------------------------ */

	/**
	 * Delete cached renditions.
	 *
	 * ## OPTIONS
	 *
	 * [--network]
	 * : Purge every site's renditions, not just the current site's.
	 *
	 * [--expired]
	 * : Only delete renditions not requested within the expiry window (all sites).
	 *
	 * ## EXAMPLES
	 *
	 *     wp noon-focal purge
	 *     wp noon-focal purge --url=example.com/site2
	 *     wp noon-focal purge --network
	 *     wp noon-focal purge --expired
	 */
	public function cli( $args, $assoc_args ) {

		if ( ! empty( $assoc_args['expired'] ) ) {
			delete_site_option( self::OPTION_CURSOR );
			WP_CLI::success( sprintf( 'Deleted %d expired renditions.', $this->prune( 0 ) ) );
			return;
		}

		if ( ! empty( $assoc_args['network'] ) ) {
			self::purge_network();
			WP_CLI::success( 'Image cache purged for all sites.' );
			return;
		}

		self::purge_site();
		WP_CLI::success( 'Image cache purged.' );

	}

}

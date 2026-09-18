<?php
/**
 * Removes everything the plugin created: focal point meta, the Glide cache and
 * the per-site signing secret.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

require __DIR__ . '/includes/config.php';

delete_post_meta_by_key( 'noon_focal_point' );
delete_option( 'noon_focal_warm_progress' );
wp_clear_scheduled_hook( 'noon_focal_warm_batch' );
wp_unschedule_hook( 'noon_focal_warm_attachment' );

$noon_focal_secret = noon_focal_secret_file();
if ( file_exists( $noon_focal_secret ) ) {
	unlink( $noon_focal_secret );
}

if ( is_dir( NOON_FOCAL_CACHE_DIR ) ) {
	require_once ABSPATH . 'wp-admin/includes/file.php';
	WP_Filesystem();
	global $wp_filesystem;
	$wp_filesystem->delete( NOON_FOCAL_CACHE_DIR, true );
}

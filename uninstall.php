<?php
/**
 * Removes everything the plugin created: focal point meta, the signing
 * secret and the Glide cache.
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

delete_site_option( 'noon_focal_signing_secret' );

require_once ABSPATH . 'wp-admin/includes/file.php';
WP_Filesystem();
global $wp_filesystem;

if ( $wp_filesystem->exists( noon_focal_secret_file() ) ) {
	$wp_filesystem->delete( noon_focal_secret_file() );
}

if ( is_dir( NOON_FOCAL_CACHE_DIR ) ) {
	$wp_filesystem->delete( NOON_FOCAL_CACHE_DIR, true );
}

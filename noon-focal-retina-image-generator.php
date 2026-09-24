<?php
/**
 * @link              https://noon.studio
 * @package           Noon_Focal_Retina_Image_Generator
 *
 * @wordpress-plugin
 * Plugin Name:       Studio Noon Focus Crop
 * Description:       Set a focal point on any image and get smart-cropped, responsive, retina and WebP image sizes generated on the fly. No more regenerating thumbnails.
 * Version:           1.3.2
 * Author:            Studio Noon
 * Author URI:        https://noon.studio
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Network:           true
 * Text Domain:       noon-focus-crop
 */

if ( ! defined( 'WPINC' ) ) {
	die;
}

define( 'NOON_FOCAL_RETINA_IMAGE_GENERATOR_VERSION', '1.3.2' );

if ( ! file_exists( __DIR__ . '/vendor/autoload.php' ) ) {
	add_action( 'admin_notices', function () {
		echo '<div class="notice notice-error"><p>'
			. esc_html__( 'Focal Retina Image Generator: run "composer install" in the plugin directory.', 'noon-focus-crop' )
			. '</p></div>';
	} );
	return;
}

require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/includes/config.php';
require __DIR__ . '/includes/functions.php';
require __DIR__ . '/includes/class-noon-focal-retina-image-generator-admin.php';
require __DIR__ . '/includes/class-noon-focal-retina-image-generator-warmer.php';
require __DIR__ . '/includes/class-noon-focal-retina-image-generator-status.php';

register_activation_hook( __FILE__, function () {
	noon_focal_ensure_secret();
	flush_rewrite_rules();
} );

register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );

$noon_focal = new Noon_Focal_Retina_Image_Generator_Admin( 'noon-focus-crop', NOON_FOCAL_RETINA_IMAGE_GENERATOR_VERSION );

// Self-heal the secret mirror if it was removed or the plugin was deployed without activating.
add_action( 'admin_init', 'noon_focal_ensure_secret' );

add_action( 'init', array( $noon_focal, 'register_meta' ) );
add_filter( 'mod_rewrite_rules', array( $noon_focal, 'htaccess_contents' ), 99 );
// Multisite never writes .htaccess, so tell the network admin what to add.
add_action( 'network_admin_notices', array( $noon_focal, 'htaccess_notice' ) );

add_action( 'enqueue_block_editor_assets', array( $noon_focal, 'editor_assets' ) );
add_action( 'admin_enqueue_scripts', array( $noon_focal, 'admin_assets' ) );
add_filter( 'attachment_fields_to_edit', array( $noon_focal, 'attachment_fields_to_edit' ), 10, 2 );
add_filter( 'attachment_fields_to_save', array( $noon_focal, 'attachment_fields_to_save' ), 10, 2 );

// Serve every size except the thumbnail file through Glide.
add_filter( 'intermediate_image_sizes_advanced', array( $noon_focal, 'intermediate_image_sizes_advanced' ), 99 );
add_filter( 'image_downsize', array( $noon_focal, 'image_downsize' ), 10, 3 );
add_filter( 'wp_calculate_image_srcset_meta', array( $noon_focal, 'wp_calculate_image_srcset_meta' ), 10, 4 );
add_filter( 'wp_calculate_image_srcset', array( $noon_focal, 'wp_calculate_image_srcset' ), 10, 5 );
// Sizes registered with noon_focal_add_image_size(): width ladder, sizes attribute, <picture> per breakpoint.
add_filter( 'wp_calculate_image_srcset', array( $noon_focal, 'responsive_srcset' ), 20, 5 );
add_filter( 'wp_calculate_image_sizes', array( $noon_focal, 'responsive_sizes_attr' ), 10, 5 );
add_filter( 'wp_get_attachment_image', array( $noon_focal, 'picture_wrap' ), 10, 5 );
// Re-sign <img> tags saved in block content so they follow the current focal point.
add_filter( 'wp_content_img_tag', array( $noon_focal, 'content_img_tag' ), 20, 3 );

// Purge Glide's cache when the focal point changes or the attachment is deleted.
foreach ( array( 'added_post_meta', 'updated_post_meta', 'deleted_post_meta' ) as $noon_focal_hook ) {
	add_action( $noon_focal_hook, array( $noon_focal, 'focal_point_changed' ), 10, 3 );
}
add_action( 'delete_attachment', array( $noon_focal, 'delete_attachment' ) );

// Pre-build renditions in the background (uploads, focal changes, bulk action, Settings → Media, WP-CLI).
( new Noon_Focal_Retina_Image_Generator_Warmer() )->register();

// "Is it working?" checks on Settings → Media.
( new Noon_Focal_Retina_Image_Generator_Status() )->register();

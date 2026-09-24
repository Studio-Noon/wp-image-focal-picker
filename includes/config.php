<?php
/**
 * Signing secret for Glide image URLs, generated automatically —
 * see noon_focal_ensure_secret(). The `noon_focal_signing_secret` network
 * option is the source of truth; it's mirrored to a file in the uploads
 * directory (WP_Filesystem, protected by insert_with_markers()) because
 * media.php reads it without booting WordPress, so it has no wpdb. Undefined
 * is not an error: noon_focal_glide_url() and media.php both fall back to
 * building and accepting unsigned requests. This file must stay free of
 * WordPress dependencies itself: media.php loads it without booting WordPress.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

// Not the standard ABSPATH guard: this file is deliberately loadable
// outside WordPress by media.php (see that file's docblock), which defines
// NOON_FOCAL_MEDIA_ENDPOINT instead of booting WordPress. Direct access by
// anything else is blocked.
if ( ! defined( 'ABSPATH' ) && ! defined( 'NOON_FOCAL_MEDIA_ENDPOINT' ) ) {
	exit;
}

if ( ! defined( 'NOON_FOCAL_CONTENT_DIR' ) ) {
	// Prefer WordPress' own constant when it's loaded (every path except
	// media.php's, which runs without WordPress and so falls back to deriving
	// wp-content from this file's location).
	define( 'NOON_FOCAL_CONTENT_DIR', defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : dirname( __DIR__, 3 ) );
}

if ( ! defined( 'NOON_FOCAL_CACHE_DIR' ) ) {
	define( 'NOON_FOCAL_CACHE_DIR', NOON_FOCAL_CONTENT_DIR . '/cache/noon-images' );
}

if ( ! defined( 'NOON_FOCAL_UPLOADS_DIR' ) ) {
	define( 'NOON_FOCAL_UPLOADS_DIR', NOON_FOCAL_CONTENT_DIR . '/uploads' );
}

if ( ! function_exists( 'noon_focal_webp_supported' ) ) {

	function noon_focal_webp_supported() {
		return function_exists( 'imagewebp' ) || class_exists( 'Imagick' );
	}

	/**
	 * Whether Glide can decode the file. SVG and other non-raster uploads pass
	 * wp_attachment_is_image() (with plugins such as Safe SVG) but GD cannot
	 * read them, so they are served untouched.
	 *
	 * @param string $file Path or URL of the upload.
	 */
	function noon_focal_is_raster( $file ) {
		$extension = strtolower( pathinfo( (string) $file, PATHINFO_EXTENSION ) );
		return in_array( $extension, array( 'jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp' ), true );
	}

	/**
	 * Glide parameters applied to every rendition of a file. Shared by media.php
	 * and the cache warmer so both produce identical cache keys.
	 *
	 * @param string $file Path of the upload, used for its extension.
	 * @param bool   $webp Whether to output WebP (client accepts it and PHP can encode it).
	 */
	function noon_focal_default_params( $file, $webp ) {

		$extension = strtolower( pathinfo( $file, PATHINFO_EXTENSION ) );

		// PNG/GIF keep their format (transparency, animation); everything else becomes JPEG.
		$params = array(
			'q'  => 80,
			'dpr' => 1,
			'fm' => in_array( $extension, array( 'png', 'gif' ), true ) ? $extension : 'jpg',
		);

		if ( $webp && noon_focal_webp_supported() && 'gif' !== $extension ) {
			$params['fm'] = 'webp';
		}

		return $params;

	}

}

if ( ! function_exists( 'noon_focal_allowed_glide_params' ) ) {

	/**
	 * Query keys Glide's active manipulators use. Mirrors
	 * League\Glide\Api\Api::GLOBAL_API_PARAMS and the getApiParams() of every
	 * manipulator League\Glide\ServerFactory::getManipulators() registers,
	 * minus the Watermark manipulator's `mark*` keys and the preset `p` key:
	 * neither watermarks nor presets are configured in any of this plugin's
	 * ServerFactory::create() calls, so those keys do nothing today. `s`
	 * (signature) is kept so SignatureFactory can validate it; Glide itself
	 * strips `s` and `p` before running manipulations.
	 *
	 * @return string[]
	 */
	function noon_focal_allowed_glide_params() {
		return array(
			's', 'q', 'fm',                                                 // Global.
			'or',                                                           // Orientation.
			'crop',                                                         // Crop.
			'w', 'h', 'fit', 'dpr',                                         // Size.
			'bri', 'con', 'gam', 'sharp', 'filt', 'flip', 'blur', 'pixel',  // Adjustments.
			'bg', 'border',                                                 // Background / Border.
		);
	}

	/**
	 * Reduce a raw query-string params array (e.g. from parse_str()) to the
	 * allowlisted keys above, dropping everything else and any non-scalar
	 * value — parse_str() turns a request like `w[]=1` into a nested array,
	 * which Glide's manipulators were never designed to receive.
	 *
	 * @param array $params Raw params, keyed by query string name.
	 * @return array<string, string> Allowlisted, scalar-only params.
	 */
	function noon_focal_sanitize_glide_params( array $params ) {

		$allowed = array_flip( noon_focal_allowed_glide_params() );
		$clean   = array();

		foreach ( $params as $key => $value ) {
			if ( isset( $allowed[ $key ] ) && is_scalar( $value ) ) {
				$clean[ $key ] = (string) $value;
			}
		}

		return $clean;

	}

}

if ( ! function_exists( 'noon_focal_secret_file' ) ) {

	function noon_focal_secret_file() {
		return NOON_FOCAL_UPLOADS_DIR . '/.noon-focal-secret';
	}

	/**
	 * Ensure a signing secret exists: the `noon_focal_signing_secret` network
	 * option is the source of truth (generated once with wp_generate_password()),
	 * mirrored via WP_Filesystem to the uploads-dir file media.php reads, since
	 * that process never boots WordPress and so has no wpdb. Called on
	 * activation and admin_init, so it self-heals if the file is ever removed.
	 *
	 * A secret is optional: if this never runs, or a write fails, the site
	 * just serves images unsigned rather than not at all.
	 *
	 * @return bool True once a secret is defined.
	 */
	function noon_focal_ensure_secret() {

		$secret = get_site_option( 'noon_focal_signing_secret' );

		if ( ! $secret ) {
			$secret = wp_generate_password( 64, true, true );
			update_site_option( 'noon_focal_signing_secret', $secret );
		}

		if ( ! defined( 'NOON_IMAGE_SECRET' ) ) {
			define( 'NOON_IMAGE_SECRET', $secret );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		if ( ! WP_Filesystem() ) {
			return true; // Secret is defined either way; only the mirror failed.
		}

		global $wp_filesystem;

		$wp_filesystem->put_contents( noon_focal_secret_file(), $secret, FS_CHMOD_FILE );

		require_once ABSPATH . 'wp-admin/includes/misc.php';

		insert_with_markers(
			NOON_FOCAL_UPLOADS_DIR . '/.htaccess',
			'Focal Retina Image Generator',
			array( '<Files ".noon-focal-secret">', 'Require all denied', '</Files>' )
		);

		return true;

	}

}

if ( ! defined( 'NOON_IMAGE_SECRET' ) && file_exists( noon_focal_secret_file() ) ) {
	$noon_focal_secret = trim( (string) @file_get_contents( noon_focal_secret_file() ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_get_contents, WordPress.PHP.NoSilencedErrors.Discouraged -- must work without WordPress; noon_focal_ensure_secret() is the WP_Filesystem write path.
	if ( '' !== $noon_focal_secret ) {
		define( 'NOON_IMAGE_SECRET', $noon_focal_secret );
	}
}
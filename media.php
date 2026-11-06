<?php
/**
 * Glide endpoint. The web server rewrites upload URLs (?w=&h=, plus &s= when
 * the site has a signing secret) here so the image can be resized/cropped/
 * encoded on the fly and cached.
 *
 * Intentionally does not boot WordPress: every image request passes through
 * this file, cached or not, and loading WordPress for each one would defeat
 * the purpose. Nothing is rendered without a signature that validates against
 * the secret (includes/config.php); an unsigned or invalid request, or any
 * request while the secret cannot be read, gets the original file instead.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

// This intentionally does NOT exit when ABSPATH is undefined — that is the
// expected, documented state for every real request to this file (see the
// docblock above: this is a standalone endpoint the web server rewrites
// image URLs to directly, and it must not boot WordPress). What follows is
// this file's replacement for the standard ABSPATH guard: refuse anything
// that isn't a genuine Glide-parameterised request before doing any work.
if ( ! defined( 'ABSPATH' ) ) {
	// Not loaded by WordPress, as intended. Cheaply refuse an empty query
	// string before loading config.php/vendor; everything else is decided
	// below, once we know whether the site has a signing secret.
	if ( '' === (string) ( $_SERVER['QUERY_STRING'] ?? '' ) ) {
		http_response_code( 404 );
		exit;
	}
}

define( 'NOON_FOCAL_MEDIA_ENDPOINT', true );

require __DIR__ . '/includes/config.php';
require __DIR__ . '/vendor/autoload.php';

use League\Glide\Filesystem\FileNotFoundException;
use League\Glide\ServerFactory;
use League\Glide\Signatures\SignatureException;
use League\Glide\Signatures\SignatureFactory;

/**
 * End the request with an error status that no browser or CDN keeps.
 *
 * @param int $code HTTP status.
 */
function noon_focal_fail( $code ) {

	http_response_code( $code );

	if ( ! headers_sent() ) {
		header_remove( 'Vary' );
		header( 'Cache-Control: no-store' );
	}

	exit;

}

/**
 * Serve the untouched upload instead. `direct=true` is excluded by the rewrite
 * rule so the web server delivers the file itself.
 *
 * @param string $path      Request path.
 * @param string $file_path Path inside the uploads directory.
 */
function noon_focal_serve_original( $path, $file_path ) {

	// Resolve against the uploads dir: on a subdirectory multisite the request
	// path may carry a site slug that does not exist on disk.
	if ( ! is_file( NOON_FOCAL_UPLOADS_DIR . '/' . $file_path ) ) {
		noon_focal_fail( 404 );
	}

	// Short-lived: the redirect stands in for a rendition, which may become
	// available (e.g. once the secret is readable).
	header( 'Cache-Control: public, max-age=300' );

	// A path starting "//" or "/\" would be read by browsers as another host
	// (e.g. //2130706433/… is 127.0.0.1), making this an open redirect.
	header( 'Location: /' . ltrim( $path, '/\\' ) . '?direct=true', true, 302 );
	exit;

}

/**
 * Handle the current request.
 */
function noon_focal_serve_request() {

	// WordPress' sanitisation helpers are not available here; the path is only
	// ever used to look a file up inside the uploads directory, and Glide
	// refuses traversal, but be explicit about it anyway.
	$uri = (string) ( $_SERVER['REQUEST_URI'] ?? '' ); 

	list( $path, $query ) = array_pad( explode( '?', $uri, 2 ), 2, '' );

	$path   = rawurldecode( $path );
	$prefix = strpos( $path, '/uploads/' );

	// Only reachable through the upload rewrite. Requested directly as
	// …/media.php/uploads/… (PATH_INFO), it would answer for files the web
	// server's own rules keep private (e.g. a denied uploads subdirectory).
	$direct = '' !== (string) ( $_SERVER['PATH_INFO'] ?? $_SERVER['ORIG_PATH_INFO'] ?? '' )
		|| false !== strpos( $path, '/' . basename( __FILE__ ) . '/' );

	if ( $direct || '' === $path || false === $prefix || false !== strpos( $path, '..' ) || false !== strpos( $path, "\0" ) ) {
		noon_focal_fail( 404 );
	}

	// Everything after ".../uploads/" is the path inside the uploads directory.
	$file_path = substr( $path, $prefix + strlen( '/uploads/' ) );

	parse_str( $query, $params );

	// Only forward query keys Glide's active manipulators actually use, and
	// only scalar values (see includes/config.php). Applied before signature
	// validation so `s` is checked against — and Glide only ever receives —
	// the same allowlisted set, whether or not a request is signed.
	$params = noon_focal_sanitize_glide_params( $params );

	// Glide (GD) cannot decode SVG etc.; hand those back to the web server.
	if ( ! noon_focal_is_raster( $file_path ) ) {
		noon_focal_serve_original( $path, $file_path );
	}

	// No readable secret (see includes/config.php): fail closed rather than
	// render arbitrary unsigned requests.
	if ( ! defined( 'NOON_IMAGE_SECRET' ) ) {
		noon_focal_serve_original( $path, $file_path );
	}

	try {
		SignatureFactory::create( NOON_IMAGE_SECRET )->validateRequest( $path, $params );
	} catch ( SignatureException $e ) {
		// Serve the original image if the signature is invalid.
		noon_focal_serve_original( $path, $file_path );
	}

	try {

		$server = ServerFactory::create( array(
			'source'         => NOON_FOCAL_UPLOADS_DIR,
			'cache'          => NOON_FOCAL_CACHE_DIR,
			'max_image_size' => 4000 * 4000,
		) );

		$accept       = (string) ( $_SERVER['HTTP_ACCEPT'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- only tested for a substring, no WordPress available.
		$accepts_webp = false !== strpos( $accept, 'image/webp' );
		$defaults     = noon_focal_default_params( $file_path, $accepts_webp );

		// The response depends on the Accept header, so caches must key on it.
		header( 'Vary: Accept' );

		$params = array_merge( $defaults, $params );

		// Only Glide's own caching headers (a year, public) may go out with a
		// rendition. Drop anything PHP added before this point (session cache
		// limiter, auto_prepend_file, host defaults) such as no-store or Pragma.
		// Headers the web server adds afterwards are handled by this plugin's
		// .htaccess (Apache) or the server config (nginx); see the README.
		header_remove( 'Cache-Control' );
		header_remove( 'Pragma' );
		header_remove( 'Expires' );

		$server->outputImage( $file_path, $params );

		// Mark the rendition as used so the daily prune keeps it. At most once
		// a day per file, and after output so this response is unaffected.
		$cached = NOON_FOCAL_CACHE_DIR . '/' . $server->getCachePath( $file_path, $params );
		if ( is_file( $cached ) && filemtime( $cached ) < time() - 86400 ) {
			@touch( $cached ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- no WordPress here; a read-only cache just skips the touch.
		}

	} catch ( FileNotFoundException $e ) {

		noon_focal_fail( 404 );

	} catch ( Throwable $e ) {

		// Without WordPress the PHP error log is the only channel for this.
		error_log( 'noon-focus-crop: ' . $e->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		noon_focal_fail( 500 );

	}

}

noon_focal_serve_request();

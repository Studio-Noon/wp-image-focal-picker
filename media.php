<?php
/**
 * Glide endpoint. Apache rewrites signed upload URLs (?w=&h=&s=) here so the
 * image can be resized/cropped/encoded on the fly and cached.
 *
 * Intentionally does not boot WordPress: every image request passes through
 * this file, cached or not.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

require __DIR__ . '/includes/config.php';
require __DIR__ . '/vendor/autoload.php';

use League\Glide\Filesystem\FileNotFoundException;
use League\Glide\ServerFactory;
use League\Glide\Signatures\SignatureException;
use League\Glide\Signatures\SignatureFactory;

/**
 * Serve the untouched upload instead. `direct=true` is excluded by the rewrite
 * rule so the web server delivers the file itself.
 */
function noon_focal_serve_original( $path, $file_path ) {

	// Resolve against the uploads dir: on a subdirectory multisite the request
	// path may carry a site slug that does not exist on disk.
	if ( ! is_file( NOON_FOCAL_UPLOADS_DIR . '/' . $file_path ) ) {
		http_response_code( 404 );
		exit;
	}

	header( 'Location: ' . $path . '?direct=true', true, 302 );
	exit;

}

$request = parse_url( $_SERVER['REQUEST_URI'] );
$path    = $request['path'] ?? '';
$prefix  = strpos( $path, '/uploads/' );

if ( '' === $path || false === $prefix ) {
	http_response_code( 404 );
	exit;
}

// Everything after ".../uploads/" is the path inside the uploads directory.
$file_path = substr( $path, $prefix + strlen( '/uploads/' ) );

parse_str( $request['query'] ?? '', $params );

// Glide (GD) cannot decode SVG etc.; hand those back to the web server.
if ( ! noon_focal_is_raster( $file_path ) ) {
	noon_focal_serve_original( $path, $file_path );
}

if ( ! defined( 'NOON_IMAGE_SECRET' ) ) {
	// No secret means nothing can be verified; refuse rather than sign with a guess.
	http_response_code( 503 );
	exit;
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

	$accepts_webp = false !== strpos( $_SERVER['HTTP_ACCEPT'] ?? '', 'image/webp' );
	$defaults     = noon_focal_default_params( $file_path, $accepts_webp );

	// The response depends on the Accept header, so caches must key on it.
	header( 'Vary: Accept' );

	$server->outputImage( $file_path, array_merge( $defaults, $params ) );

} catch ( FileNotFoundException $e ) {

	http_response_code( 404 );

} catch ( Throwable $e ) {

	http_response_code( 500 );
	error_log( 'noon-focal-retina-image-generator: ' . $e->getMessage() );

}

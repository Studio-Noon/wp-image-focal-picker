<?php
/**
 * Template functions and shared helpers for building signed Glide URLs.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use League\Glide\Urls\UrlBuilderFactory;

/**
 * Glide URL for an attachment's original file, signed when a secret is
 * available and unsigned otherwise — see includes/config.php.
 *
 * @param int   $attachment_id
 * @param array $params Glide parameters (w, h, fit, dpr, fm, q…).
 * @return string Empty when the attachment has no file.
 */
function noon_focal_glide_url( $attachment_id, array $params ) {

	static $builder = null;

	$file = get_post_meta( $attachment_id, '_wp_attached_file', true );

	if ( ! $file || ! noon_focal_is_raster( $file ) ) {
		return '';
	}

	if ( null === $builder ) {
		// Glide signs only the path component, which is what media.php checks.
		$builder = defined( 'NOON_IMAGE_SECRET' )
			? UrlBuilderFactory::create( wp_get_upload_dir()['baseurl'], NOON_IMAGE_SECRET )
			: UrlBuilderFactory::create( wp_get_upload_dir()['baseurl'] );
	}

	return $builder->getUrl( $file, $params );

}

/**
 * Path of the original upload relative to the shared uploads directory, i.e.
 * what media.php derives from the URL and what Glide keys its cache on. On a
 * subsite _wp_attached_file alone omits the "sites/N/" prefix.
 */
function noon_focal_source_path( $attachment_id ) {

	$file = get_post_meta( $attachment_id, '_wp_attached_file', true );

	if ( ! $file ) {
		return '';
	}

	$absolute = wp_normalize_path( trailingslashit( wp_get_upload_dir()['basedir'] ) . $file );
	$base     = trailingslashit( wp_normalize_path( NOON_FOCAL_UPLOADS_DIR ) );

	return 0 === strpos( $absolute, $base ) ? substr( $absolute, strlen( $base ) ) : $file;

}

/**
 * All registered image sizes as name => ['w' => int, 'h' => int, 'crop' => bool].
 */
function noon_focal_registered_sizes() {

	$sizes = array();

	foreach ( wp_get_registered_image_subsizes() as $name => $size ) {
		$sizes[ $name ] = array(
			'w'    => (int) $size['width'],
			'h'    => (int) $size['height'],
			'crop' => ! empty( $size['crop'] ),
		);
	}

	return $sizes;

}

/**
 * Resolve a size name, [w, h] or ['w' => , 'h' => ] into ['w', 'h', 'crop'].
 * Returns null for an unknown size name.
 */
function noon_focal_resolve_size( $size ) {

	if ( is_array( $size ) ) {
		$w = $size['w'] ?? $size['width'] ?? $size[0] ?? 0;
		$h = $size['h'] ?? $size['height'] ?? $size[1] ?? 0;
		return array( 'w' => (int) $w, 'h' => (int) $h, 'crop' => $size['crop'] ?? true );
	}

	return noon_focal_registered_sizes()[ (string) $size ] ?? null;

}

/**
 * Final width/height for an attachment at a size, following WordPress rules:
 * cropped sizes use the exact box, uncropped sizes are constrained to fit it.
 * Returns null when the size is unknown or unusable.
 */
function noon_focal_dimensions( $attachment_id, $size ) {

	$box = noon_focal_resolve_size( $size );

	if ( ! $box || ( $box['w'] < 1 && $box['h'] < 1 ) ) {
		return null;
	}

	$meta = wp_get_attachment_metadata( $attachment_id );
	$orig = array( (int) ( $meta['width'] ?? 0 ), (int) ( $meta['height'] ?? 0 ) );

	if ( $box['crop'] && $box['w'] > 0 && $box['h'] > 0 ) {
		return array( 'w' => $box['w'], 'h' => $box['h'] );
	}

	if ( $orig[0] > 0 && $orig[1] > 0 ) {
		list( $w, $h ) = wp_constrain_dimensions( $orig[0], $orig[1], $box['w'], $box['h'] );
		return ( $w > 0 && $h > 0 ) ? array( 'w' => $w, 'h' => $h ) : null;
	}

	// No metadata to derive the missing side from; Glide scales by the one given.
	return array( 'w' => $box['w'], 'h' => $box['h'] );

}

/**
 * Glide params (w, h, fit) for an attachment at a size, or null.
 */
function noon_focal_image_params( $attachment_id, $size, $fit = 'crop' ) {

	$dimensions = noon_focal_dimensions( $attachment_id, $size );

	if ( ! $dimensions ) {
		return null;
	}

	if ( 'crop' === $fit ) {
		$fit = Noon_Focal_Retina_Image_Generator_Admin::get_fit( $attachment_id );
	}

	$params = array( 'w' => $dimensions['w'], 'h' => $dimensions['h'], 'fit' => $fit );

	if ( $dimensions['h'] < 1 ) {
		unset( $params['h'] );
	}

	return $params;

}

/* -------------------------------------------------------------------------
 * Responsive sizes
 * ---------------------------------------------------------------------- */

/**
 * add_image_size() plus a responsive definition, so wp_get_attachment_image()
 * and the_post_thumbnail() deliver the size at more than one box.
 *
 * @param string $name
 * @param int    $width
 * @param int    $height
 * @param bool   $crop
 * @param array  $args {
 *     @type array  $breakpoints Viewport min-width (px) => box, where a box is [w, h],
 *                               ['w' => , 'h' => , 'crop' => ] or a registered size name.
 *                               The size's own box serves viewports below the smallest
 *                               min-width; a 0 key overrides it. Output is a <picture>
 *                               with one <source> per breakpoint at 1x/1.5x/2x.
 *     @type int[]  $widths      srcset widths at the size's own aspect ratio. Ignored when
 *                               breakpoints are given. Defaults to an automatic ladder.
 *     @type string $sizes       The sizes attribute. Auto-generated when omitted.
 * }
 */
function noon_focal_add_image_size( $name, $width, $height = 0, $crop = false, array $args = array() ) {
	add_image_size( $name, $width, $height, $crop );
	noon_focal_set_responsive_size( $name, $args );
}

/**
 * Attach a responsive definition to an already-registered size (core sizes
 * included). See noon_focal_add_image_size() for $args.
 */
function noon_focal_set_responsive_size( $name, array $args = array() ) {

	$config = array(
		'breakpoints' => array(),
		'widths'      => array(),
		'sizes'       => '',
	);

	foreach ( (array) ( $args['breakpoints'] ?? array() ) as $min_width => $box ) {
		$box = noon_focal_resolve_size( $box );
		if ( $box && ( $box['w'] > 0 || $box['h'] > 0 ) ) {
			$config['breakpoints'][ max( 0, (int) $min_width ) ] = $box;
		}
	}
	ksort( $config['breakpoints'], SORT_NUMERIC );

	$config['widths'] = array_values( array_unique( array_filter( array_map( 'intval', (array) ( $args['widths'] ?? array() ) ) ) ) );
	sort( $config['widths'] );

	$config['sizes'] = (string) ( $args['sizes'] ?? '' );

	noon_focal_responsive_sizes( array( (string) $name => $config ) );

}

/**
 * All responsive definitions as name => ['breakpoints', 'widths', 'sizes'].
 * Registry lives here; pass $add to register (used by noon_focal_set_responsive_size()).
 */
function noon_focal_responsive_sizes( array $add = null ) {

	static $sizes = array();

	if ( null !== $add ) {
		$sizes = array_merge( $sizes, $add );
		return $sizes;
	}

	return apply_filters( 'noon_focal_responsive_sizes', $sizes );

}

/**
 * Responsive definition for a size name, or null. Array sizes never match.
 */
function noon_focal_responsive_size( $name ) {

	if ( ! is_string( $name ) ) {
		return null;
	}

	return noon_focal_responsive_sizes()[ $name ] ?? null;

}

/**
 * The box a responsive size uses below its smallest breakpoint: the size's
 * registered box unless a 0 breakpoint overrides it.
 */
function noon_focal_responsive_base( $name ) {
	$config = noon_focal_responsive_size( $name );
	return $config['breakpoints'][0] ?? noon_focal_resolve_size( $name );
}

/**
 * srcset boxes for a responsive size without breakpoints: its widths (or the
 * automatic ladder) times every dpr, at the size's aspect ratio, capped at the
 * original. Each is ['w' => , 'h' => ]. Empty for breakpoint sizes.
 */
function noon_focal_responsive_candidates( $attachment_id, $name ) {

	$config = noon_focal_responsive_size( $name );

	if ( ! $config || $config['breakpoints'] ) {
		return array();
	}

	$box = noon_focal_dimensions( $attachment_id, noon_focal_responsive_base( $name ) );

	if ( ! $box || $box['w'] < 1 || $box['h'] < 1 ) {
		return array();
	}

	$widths = $config['widths'];

	if ( ! $widths ) {
		/**
		 * Widths offered for responsive sizes that give none of their own. Only
		 * those below the size's width are used; the width itself is always added.
		 */
		$ladder = apply_filters( 'noon_focal_auto_widths', array( 320, 480, 640, 768, 1024, 1280, 1536, 1920 ), $name );
		$widths = array_filter( array_map( 'intval', (array) $ladder ), function ( $w ) use ( $box ) {
			return $w > 0 && $w < $box['w'];
		} );
	}

	$widths[] = $box['w'];

	$meta = wp_get_attachment_metadata( $attachment_id );
	$max  = (int) ( $meta['width'] ?? 0 );

	$candidates = array();

	foreach ( $widths as $w ) {
		foreach ( Noon_Focal_Retina_Image_Generator_Admin::dprs() as $dpr ) {

			$cw = (int) round( $w * $dpr );

			if ( $cw < 1 || ( $max > 0 && $cw > $max ) ) {
				continue;
			}

			$candidates[ $cw ] = array(
				'w' => $cw,
				'h' => max( 1, (int) round( $cw * $box['h'] / $box['w'] ) ),
			);

		}
	}

	ksort( $candidates, SORT_NUMERIC );

	return array_values( $candidates );

}

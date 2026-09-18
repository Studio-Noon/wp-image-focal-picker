<?php
/**
 * Template functions and shared helpers for building signed Glide URLs.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

use League\Glide\Urls\UrlBuilderFactory;

/**
 * Signed, absolute Glide URL for an attachment's original file.
 *
 * @param int   $attachment_id
 * @param array $params Glide parameters (w, h, fit, dpr, fm, q…).
 * @return string Empty when the attachment has no file.
 */
function noon_focal_glide_url( $attachment_id, array $params ) {

	static $builder = null;

	$file = get_post_meta( $attachment_id, '_wp_attached_file', true );

	if ( ! $file || ! noon_focal_is_raster( $file ) || ! defined( 'NOON_IMAGE_SECRET' ) ) {
		return '';
	}

	if ( null === $builder ) {
		// Glide signs only the path component, which is what media.php checks.
		$builder = UrlBuilderFactory::create( wp_get_upload_dir()['baseurl'], NOON_IMAGE_SECRET );
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

/**
 * Signed Glide URL for an attachment at a size.
 *
 * @deprecated 1.1.0 Use wp_get_attachment_image_url( $id, $size ); for 2x use
 *                   wp_get_attachment_image_srcset() or wp_get_attachment_image().
 *
 * @param int          $attachment_id
 * @param string|array $size   Registered size name, [w, h] or ['w' => , 'h' => ].
 * @param bool         $retina Request the 2x (dpr=2) rendition.
 * @param string       $fit    Glide fit; 'crop' uses the stored focal point.
 * @return string Empty for an unknown size or missing file.
 */
if ( ! function_exists( 'noon_get_attachment_image_url' ) ) {
	function noon_get_attachment_image_url( $attachment_id, $size = 'thumbnail', $retina = false, $fit = 'crop' ) {

		_deprecated_function( __FUNCTION__, '1.1.0', 'wp_get_attachment_image_url()' );

		$params = noon_focal_image_params( $attachment_id, $size, $fit );

		if ( ! $params ) {
			return '';
		}

		if ( $retina ) {
			$params['dpr'] = 2;
		}

		return noon_focal_glide_url( $attachment_id, $params );

	}
}

/**
 * Output a responsive <picture> (or single <img>) with 1x/2x signed Glide URLs.
 *
 * @deprecated 1.1.0 Use wp_get_attachment_image( $id, $size, false, [ 'class' => …, 'sizes' => … ] ):
 *                   it now emits focal-cropped Glide URLs with a 1x/1.5x/2x srcset and
 *                   loading="lazy". For art direction (a different size per breakpoint) build
 *                   a <picture> from wp_get_attachment_image_srcset( $id, $size ) per <source>.
 *
 * @param int   $attachment_id
 * @param array $attr {
 *     @type string|array $default      Size used for the fallback <img>. Default 'medium'.
 *     @type bool         $echo         Echo (true) or return (false). Default true.
 *     @type string       $type         'picture' or 'img'. Default 'picture'.
 *     @type string       $class        Extra class names for the <img>.
 *     @type array        $breakpoints  min-width (px) => size. One entry switches to a single <img>.
 *     @type bool         $transparency Force PNG output.
 *     @type bool         $lazy         Emit data-src/data-srcset + class "lazy" and loading="lazy". Default true.
 * }
 * @return string|void
 */
if ( ! function_exists( 'noon_get_attachment_image' ) ) {
function noon_get_attachment_image( $attachment_id, $attr = array() ) {

	_deprecated_function( __FUNCTION__, '1.1.0', 'wp_get_attachment_image()' );

	$attr = wp_parse_args( $attr, array(
		'default'      => 'medium',
		'echo'         => true,
		'type'         => 'picture',
		'class'        => '',
		'breakpoints'  => array(),
		'transparency' => false,
		'lazy'         => true,
	) );

	$breakpoints = is_array( $attr['breakpoints'] ) ? $attr['breakpoints'] : array();
	$lazy        = ! empty( $attr['lazy'] );
	$extra       = $attr['transparency'] ? array( 'fm' => 'png' ) : array();

	// A single breakpoint is just an image at that size.
	if ( 1 === count( $breakpoints ) ) {
		$attr['type']    = 'img';
		$attr['default'] = reset( $breakpoints );
		$breakpoints     = array();
	}

	$srcset = function ( $size ) use ( $attachment_id, $extra ) {
		$params = noon_focal_image_params( $attachment_id, $size );
		if ( ! $params ) {
			return null;
		}
		$params += $extra;
		return array(
			'params' => $params,
			'srcset' => noon_focal_glide_url( $attachment_id, $params ) . ' 1x, '
				. noon_focal_glide_url( $attachment_id, $params + array( 'dpr' => 2 ) ) . ' 2x',
		);
	};

	$fallback = $srcset( $attr['default'] );
	$alt      = (string) get_post_meta( $attachment_id, '_wp_attachment_image_alt', true );
	$class    = trim( ( $lazy ? 'lazy ' : '' ) . $attr['class'] );

	$img  = '<img';
	$img .= ' class="' . esc_attr( $class ) . '"';
	$img .= ' alt="' . esc_attr( $alt ) . '"';

	if ( $fallback ) {
		$src  = noon_focal_glide_url( $attachment_id, $fallback['params'] );
		$img .= ' width="' . (int) $fallback['params']['w'] . '"';
		if ( ! empty( $fallback['params']['h'] ) ) {
			$img .= ' height="' . (int) $fallback['params']['h'] . '"';
		}
		$img .= $lazy
			? ' loading="lazy" data-src="' . esc_url( $src ) . '" data-srcset="' . esc_attr( $fallback['srcset'] ) . '"'
			: ' src="' . esc_url( $src ) . '" srcset="' . esc_attr( $fallback['srcset'] ) . '"';
	}

	$img .= '>';

	$html = '<picture>';

	if ( 'img' !== $attr['type'] ) {

		krsort( $breakpoints, SORT_NUMERIC );

		foreach ( $breakpoints as $min_width => $size ) {
			$source = $srcset( $size );
			if ( ! $source ) {
				continue;
			}
			$html .= '<source media="(min-width: ' . (int) $min_width . 'px)" '
				. ( $lazy ? 'data-srcset' : 'srcset' ) . '="' . esc_attr( $source['srcset'] ) . '">';
		}

	}

	$html .= $img . '</picture>';

	if ( empty( $attr['echo'] ) ) {
		return $html;
	}

	echo $html;

}
}

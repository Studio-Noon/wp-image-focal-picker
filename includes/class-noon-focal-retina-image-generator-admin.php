<?php
/**
 * Focal point meta, media-modal UI, rewrite rule, and the hooks that swap
 * WordPress' generated image sizes for signed Glide URLs.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

use League\Glide\ServerFactory;

class Noon_Focal_Retina_Image_Generator_Admin {

	const META = 'noon_focal_point';

	private $plugin_name;
	private $version;

	public function __construct( $plugin_name, $version ) {
		$this->plugin_name = $plugin_name;
		$this->version     = $version;
	}

	/* ---------------------------------------------------------------------
	 * Meta
	 * ------------------------------------------------------------------ */

	public function register_meta() {

		register_post_meta(
			'attachment',
			self::META,
			array(
				'type'              => 'object',
				'description'       => __( 'Focal point of the image, as fractions of width and height (0–1).', 'noon-focus-crop' ),
				'single'            => true,
				'sanitize_callback' => array( __CLASS__, 'sanitize_focus' ),
				'auth_callback'     => function ( $allowed, $meta_key, $post_id ) {
					return current_user_can( 'edit_post', $post_id );
				},
				'show_in_rest'      => array(
					'schema' => array(
						'type'       => 'object',
						'properties' => array(
							'x' => array( 'type' => 'number', 'minimum' => 0, 'maximum' => 1 ),
							'y' => array( 'type' => 'number', 'minimum' => 0, 'maximum' => 1 ),
						),
					),
				),
			)
		);

	}

	/**
	 * Normalise a focal point to ['x' => 0–1, 'y' => 0–1].
	 * Accepts assoc or [x, y] arrays; values above 1 are treated as percentages.
	 */
	public static function sanitize_focus( $value ) {

		if ( ! is_array( $value ) ) {
			return array( 'x' => 0.5, 'y' => 0.5 );
		}

		$x = $value['x'] ?? $value[0] ?? 0.5;
		$y = $value['y'] ?? $value[1] ?? 0.5;

		$clamp = function ( $n ) {
			$n = (float) $n;
			if ( $n > 1 ) {
				$n = $n / 100;
			}
			return round( min( 1, max( 0, $n ) ), 4 );
		};

		return array( 'x' => $clamp( $x ), 'y' => $clamp( $y ) );

	}

	/**
	 * Stored focal point, or the (filterable) default.
	 */
	public static function get_focus( $attachment_id ) {

		$focus = get_post_meta( $attachment_id, self::META, true );

		if ( ! is_array( $focus ) || ( ! isset( $focus['x'], $focus['y'] ) && ! isset( $focus[0], $focus[1] ) ) ) {
			/**
			 * Default focal point for images without one, as [x, y] fractions (0–1).
			 *
			 * @param array $focus         [x, y].
			 * @param int   $attachment_id
			 */
			$focus = apply_filters( 'noon_focal_default_focus', array( 0.5, 0.5 ), $attachment_id );
		}

		return self::sanitize_focus( $focus );

	}

	/**
	 * Glide `fit` value for an attachment: a focal crop when one is set.
	 */
	public static function get_fit( $attachment_id ) {

		$focus = self::get_focus( $attachment_id );

		return 'crop-' . round( $focus['x'] * 100 ) . '-' . round( $focus['y'] * 100 );

	}

	/* ---------------------------------------------------------------------
	 * Media modal fields
	 * ------------------------------------------------------------------ */

	public function attachment_fields_to_edit( $fields, $post ) {

		if ( ! wp_attachment_is_image( $post ) ) {
			return $fields;
		}

		$focus = self::get_focus( $post->ID );
		$meta  = wp_get_attachment_metadata( $post->ID );

		ob_start();
		?>
		<div class="Noon_Focal_Retina_Container" data-width="<?php echo (int) ( $meta['width'] ?? 0 ); ?>" data-height="<?php echo (int) ( $meta['height'] ?? 0 ); ?>">
			<div class="focal-preview">
				<?php echo wp_get_attachment_image( $post->ID, 'full', false, array( 'class' => 'img-fluid preview', 'draggable' => 'false' ) ); ?>
				<img
					draggable="false"
					id="focal-preview-icon"
					class="icon"
					alt=""
					style="left: <?php echo esc_attr( $focus['x'] * 100 ); ?>%; top: <?php echo esc_attr( $focus['y'] * 100 ); ?>%;"
					src="data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3e %3cg fill='none' fill-rule='evenodd'%3e %3ccircle id='a' cx='10' cy='10' r='10' fill='black' fill-opacity='.3' /%3e %3ccircle cx='10' cy='10' r='9' stroke='white' stroke-opacity='.8' stroke-width='2'/%3e %3c/g%3e%3c/svg%3e"
				/>
			</div>

			<button type="button" class="noon_edit_focalpoint button" data-attachment-id="<?php echo esc_attr( $post->ID ); ?>">
				<?php esc_html_e( 'Edit Focal Point', 'noon-focus-crop' ); ?>
			</button>

			<div class="Noon_Focal_Retina_Image_Generator_Template hidden">
				<div class="Noon_Focal_Retina_Image_Generator_Dialog">
					<div class="noon-focal-editor">
						<div class="noon-focal-editor__stage">
							<div class="Noon_Focal_Retina_Image_Generator_Wrapper">
								<div class="noon-focal-stage-img"><?php echo wp_get_attachment_image( $post->ID, 'full' ); ?></div>
							</div>
							<p class="description"><?php esc_html_e( 'Click or drag the point to the most important part of the image. The crops follow it live; nothing is generated or saved until you apply.', 'noon-focus-crop' ); ?></p>
						</div>
						<div class="noon-focal-editor__previews Noon_Focal_Retina_Image_Generator_Previews noon-focal-size-previews noon-focal-size-previews--grid" data-src="<?php echo esc_url( wp_get_attachment_image_url( $post->ID, 'full' ) ); ?>">
							<div class="previews noon-focal-size-previews__grid"></div>
						</div>
					</div>
					<footer class="actions">
						<div class="noon-focal-coordinates">
							<label><span><?php esc_html_e( 'Left (%)', 'noon-focus-crop' ); ?></span><input type="number" min="0" max="100" step="0.1" data-focal-axis="x" /></label>
							<label><span><?php esc_html_e( 'Top (%)', 'noon-focus-crop' ); ?></span><input type="number" min="0" max="100" step="0.1" data-focal-axis="y" /></label>
						</div>
						<button type="button" class="button detect-faces"><?php esc_html_e( 'Suggest from faces', 'noon-focus-crop' ); ?></button>
						<span class="faces-status description" aria-live="polite"></span>
						<button type="button" class="button cancel"><?php esc_html_e( 'Cancel', 'noon-focus-crop' ); ?></button>
						<button type="button" class="button apply"><?php esc_html_e( 'Apply', 'noon-focus-crop' ); ?></button>
					</footer>
				</div>
			</div>
		</div>
		<?php
		$html = ob_get_clean();

		// Prepend so the picker sits at the top of the attachment details.
		$fields = array(
			self::META . '_y' => array(
				'input' => 'hidden',
				'label' => __( 'Focal Point Y', 'noon-focus-crop' ),
				'value' => $focus['y'],
			),
			self::META . '_x' => array(
				'input' => 'hidden',
				'label' => __( 'Focal Point X', 'noon-focus-crop' ),
				'value' => $focus['x'],
			),
			self::META        => array(
				'input' => 'html',
				'label' => __( 'Focal Point Picker', 'noon-focus-crop' ),
				'html'  => $html,
			),
		) + $fields;

		return $fields;

	}

	public function attachment_fields_to_save( $post, $attachment ) {

		if ( isset( $attachment[ self::META . '_x' ], $attachment[ self::META . '_y' ] ) ) {

			$focus = self::sanitize_focus( array(
				'x' => $attachment[ self::META . '_x' ],
				'y' => $attachment[ self::META . '_y' ],
			) );

			// update_post_meta() compares against the stored value, so an unchanged
			// focal point (e.g. only the alt text was edited) does not purge the cache.
			update_post_meta( $post['ID'], self::META, $focus );

		}

		return $post;

	}

	/* ---------------------------------------------------------------------
	 * Assets
	 * ------------------------------------------------------------------ */

	private function enqueue_built_asset( $handle, $name, $extra_script_deps = array(), $style_file = null, $style_deps = array() ) {

		$build = plugin_dir_path( __DIR__ ) . 'admin/build/';
		$url   = plugin_dir_url( __DIR__ ) . 'admin/build/';
		$asset = file_exists( $build . $name . '.asset.php' )
			? require $build . $name . '.asset.php'
			: array( 'dependencies' => array(), 'version' => $this->version );

		wp_enqueue_script(
			$handle,
			$url . $name . '.js',
			array_merge( $asset['dependencies'], $extra_script_deps ),
			$asset['version'],
			true
		);
		wp_set_script_translations( $handle, 'noon-focus-crop' );

		if ( $style_file && file_exists( $build . $style_file ) ) {
			wp_enqueue_style( $handle, $url . $style_file, $style_deps, $asset['version'] );
		}

	}

	public function editor_assets() {
		$this->enqueue_built_asset( $this->plugin_name, 'index', array(), 'index.css', array( 'wp-edit-blocks' ) );
		$this->localize_preview_sizes( $this->plugin_name );
	}

	/**
	 * @param string $hook_suffix Current admin page, from admin_enqueue_scripts.
	 */
	public function admin_assets( $hook_suffix = '' ) {

		/**
		 * Whether to load the media-modal focal point picker on the current admin screen.
		 *
		 * @param bool   $load
		 * @param string $hook_suffix
		 */
		$load = apply_filters( 'noon_focal_enqueue_media_assets', true, (string) $hook_suffix );

		if ( ! $load ) {
			return;
		}

		$this->enqueue_built_asset(
			$this->plugin_name . '_media',
			'media',
			array( 'jquery', 'media-editor', 'jquery-ui-dialog' ),
			'style-media.css',
			array( 'wp-jquery-ui-dialog' )
		);

		$this->localize_preview_sizes( $this->plugin_name . '_media' );

	}

	/**
	 * Expose the boxes the pickers preview, and where the face-detection
	 * weights are, to a script as window.noonFocalPreview.
	 */
	private function localize_preview_sizes( $handle ) {

		$models = plugin_dir_path( __DIR__ ) . 'admin/build/models/';

		/**
		 * Whether the pickers offer "Suggest from faces" (in-browser face
		 * detection, ~1.5 MB fetched on first use).
		 *
		 * @param bool $enabled
		 */
		$faces = apply_filters( 'noon_focal_face_detection', true )
			&& file_exists( $models . 'tiny_face_detector_model-weights_manifest.json' );

		wp_add_inline_script(
			$handle,
			'window.noonFocalPreview = ' . wp_json_encode( array(
				'sizes'  => self::preview_sizes(),
				'faces'  => (bool) $faces,
				'models' => plugin_dir_url( __DIR__ ) . 'admin/build/models',
			) ) . ';',
			'before'
		);

	}

	/**
	 * Boxes shown as live crop previews under the focal point pickers: every
	 * registered size that crops (uncropped sizes keep the whole image, so the
	 * point makes no difference to them) and every responsive breakpoint box.
	 *
	 * @return array[] Each ['label' => string, 'w' => int, 'h' => int].
	 */
	public static function preview_sizes() {

		$sizes = array();

		foreach ( noon_focal_registered_sizes() as $name => $box ) {
			if ( $box['crop'] && $box['w'] > 0 && $box['h'] > 0 ) {
				$sizes[] = array( 'label' => $name, 'w' => $box['w'], 'h' => $box['h'] );
			}
		}

		foreach ( noon_focal_responsive_sizes() as $name => $config ) {
			foreach ( $config['breakpoints'] as $min_width => $box ) {
				if ( $box['crop'] && $box['w'] > 0 && $box['h'] > 0 ) {
					$sizes[] = array(
						'label' => $min_width > 0 ? sprintf( '%s ≥%dpx', $name, $min_width ) : $name,
						'w'     => $box['w'],
						'h'     => $box['h'],
					);
				}
			}
		}

		/**
		 * Boxes previewed under the focal point pickers.
		 *
		 * @param array[] $sizes Each ['label' => string, 'w' => int, 'h' => int].
		 */
		return apply_filters( 'noon_focal_preview_sizes', $sizes );

	}

	/* ---------------------------------------------------------------------
	 * Rewrite rule → media.php
	 * ------------------------------------------------------------------ */

	/**
	 * Rewrite block sending upload URLs (?w=&h=, plus &s= when the site has a
	 * signing secret) to media.php. On a subdirectory multisite the site slug
	 * may precede wp-content/, so it is matched optionally, mirroring core's
	 * own multisite rules.
	 */
	public static function htaccess_rules() {

		$target = 'wp-content/plugins/' . basename( dirname( __DIR__ ) ) . '/media.php';

		$rule  = '# BEGIN Focal Retina Image Generator' . PHP_EOL;
		$rule .= '<IfModule mod_rewrite.c>' . PHP_EOL;
		$rule .= 'RewriteEngine On' . PHP_EOL;
		$rule .= 'RewriteCond %{QUERY_STRING} !direct=true' . PHP_EOL;
		$rule .= 'RewriteCond %{QUERY_STRING} (^|&)w=[0-9]+(&|$)' . PHP_EOL;
		$rule .= 'RewriteCond %{QUERY_STRING} (^|&)h=[0-9]+(&|$)' . PHP_EOL;
		if ( defined( 'NOON_IMAGE_SECRET' ) ) {
			$rule .= 'RewriteCond %{QUERY_STRING} (^|&)s=[a-f0-9]+(&|$)' . PHP_EOL;
		}
		$rule .= 'RewriteRule ^([_0-9a-zA-Z-]+/)?wp-content/uploads/.+\\.[A-Za-z0-9]+$ ' . $target . ' [L]' . PHP_EOL;
		$rule .= '</IfModule>' . PHP_EOL;
		$rule .= '# END Focal Retina Image Generator' . PHP_EOL;

		return $rule;

	}

	/**
	 * Single site: WordPress writes the block into .htaccess on flush.
	 */
	public function htaccess_contents( $rules ) {
		return self::htaccess_rules() . PHP_EOL . $rules . PHP_EOL;
	}

	/**
	 * Multisite: save_mod_rewrite_rules() is a no-op, so the block has to be
	 * added by hand. Show it until .htaccess contains it.
	 */
	public function htaccess_notice() {

		if ( ! is_multisite() || ! current_user_can( 'manage_network_options' ) ) {
			return;
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$htaccess = get_home_path() . '.htaccess';
		$existing = is_readable( $htaccess ) ? (string) file_get_contents( $htaccess ) : '';

		if ( false !== strpos( $existing, '/media.php' ) ) {
			return;
		}

		echo '<div class="notice notice-error"><p><strong>'
			. esc_html__( 'Focal Retina Image Generator: images are not being served through Glide.', 'noon-focus-crop' )
			. '</strong> '
			. esc_html__( 'WordPress does not manage .htaccess on multisite. Add this block near the top of your .htaccess, before the RewriteCond %{REQUEST_FILENAME} -f rule:', 'noon-focus-crop' )
			. '</p><pre style="overflow:auto;padding:8px;background:#f6f7f7">' . esc_html( self::htaccess_rules() ) . '</pre></div>';

	}

	/* ---------------------------------------------------------------------
	 * Image sizes
	 * ------------------------------------------------------------------ */

	/**
	 * Only write the thumbnail file on upload (the media library grid uses it);
	 * every other size is produced on demand by Glide. Sizes stay registered so
	 * their dimensions can still be resolved.
	 */
	public function intermediate_image_sizes_advanced( $sizes ) {
		return array_intersect_key( $sizes, array( 'thumbnail' => true ) );
	}

	/**
	 * Make wp_get_attachment_image(), the_post_thumbnail() and blocks return
	 * signed Glide URLs instead of generated files. 'full' is left alone, and so
	 * is 'thumbnail' when its file exists.
	 */
	public function image_downsize( $out, $attachment_id, $size ) {

		if ( 'full' === $size || ! wp_attachment_is_image( $attachment_id ) ) {
			return $out;
		}

		if ( 'thumbnail' === $size ) {
			$meta = wp_get_attachment_metadata( $attachment_id );
			if ( ! empty( $meta['sizes']['thumbnail'] ) ) {
				return $out;
			}
		}

		// WordPress treats a plain [w, h] as a bounding box, not a crop. Pass
		// ['w' => , 'h' => , 'crop' => true] to get a focal crop at an ad-hoc size.
		if ( is_array( $size ) && ! array_key_exists( 'crop', $size ) ) {
			$size['crop'] = false;
		}

		$params = noon_focal_image_params( $attachment_id, $size );

		if ( ! $params || empty( $params['h'] ) ) {
			return $out;
		}

		$url = noon_focal_glide_url( $attachment_id, $params );

		return $url ? array( $url, $params['w'], $params['h'], true ) : $out;

	}

	/**
	 * Image and Media & Text blocks save a static <img src> at insert time, so
	 * a focal point set afterwards would never reach it. Re-sign src/srcset for
	 * every wp-image-{id} tag in content at render time, keeping the size the
	 * block chose. Full-size originals (no size in the URL) are left alone.
	 */
	public function content_img_tag( $image, $context, $attachment_id ) {

		if ( ! $attachment_id || ! class_exists( 'WP_HTML_Tag_Processor' ) || ! wp_attachment_is_image( $attachment_id ) ) {
			return $image;
		}

		$tag = new WP_HTML_Tag_Processor( $image );

		if ( ! $tag->next_tag( 'img' ) ) {
			return $image;
		}

		$src = (string) $tag->get_attribute( 'src' );

		// Blocks add a size-{name} class; a responsive size needs its name, not just its box.
		$size = $this->responsive_size_from_class( (string) $tag->get_attribute( 'class' ) );
		$size = $size ?: $this->size_from_url( $src );

		if ( ! $size || ! noon_focal_is_raster( wp_parse_url( $src, PHP_URL_PATH ) ) ) {
			return $image;
		}

		$fresh = wp_get_attachment_image_src( $attachment_id, $size );

		if ( ! $fresh || ( $fresh[0] === $src && ! is_string( $size ) ) ) {
			return $image;
		}

		$tag->set_attribute( 'src', $fresh[0] );

		$srcset = wp_get_attachment_image_srcset( $attachment_id, $size );

		if ( $srcset ) {
			$tag->set_attribute( 'srcset', $srcset );
			if ( ! $tag->get_attribute( 'sizes' ) ) {
				$tag->set_attribute( 'sizes', wp_get_attachment_image_sizes( $attachment_id, $size ) );
			}
		} else {
			$tag->remove_attribute( 'srcset' );
		}

		$image = $tag->get_updated_html();

		// Breakpoint sizes get their <picture> here too (no-op for the rest).
		return is_string( $size ) ? $this->picture_wrap( $image, $attachment_id, $size ) : $image;

	}

	/**
	 * Name of the responsive size named by a size-{name} class, or null.
	 */
	private function responsive_size_from_class( $class ) {

		if ( ! preg_match( '/(?:^|\s)size-([\w-]+)(?:\s|$)/', $class, $m ) ) {
			return null;
		}

		return noon_focal_responsive_size( $m[1] ) ? $m[1] : null;

	}

	/**
	 * The box an upload URL was rendered at: Glide's ?w=&h=, or the -WxH suffix
	 * of a size WordPress generated before the plugin. Null for an original.
	 */
	private function size_from_url( $url ) {

		$parts = wp_parse_url( $url );

		parse_str( $parts['query'] ?? '', $query );

		if ( ! empty( $query['w'] ) && ! empty( $query['h'] ) ) {
			return array( 'w' => (int) $query['w'], 'h' => (int) $query['h'], 'crop' => true );
		}

		if ( preg_match( '/-(\d+)x(\d+)\.[a-z0-9]+$/i', $parts['path'] ?? '', $m ) ) {
			return array( 'w' => (int) $m[1], 'h' => (int) $m[2], 'crop' => true );
		}

		return null;

	}

	/**
	 * Core refuses to build a srcset when the attachment has no generated sizes
	 * (uploads that predate the plugin). Register the original as a size so the
	 * candidates below are still produced.
	 */
	public function wp_calculate_image_srcset_meta( $image_meta, $size_array, $image_src, $attachment_id ) {

		if ( empty( $image_meta['sizes'] ) && ! empty( $image_meta['file'] ) && ! empty( $image_meta['width'] ) ) {
			$image_meta['sizes'] = array(
				'full' => array(
					'file'      => wp_basename( $image_meta['file'] ),
					'width'     => $image_meta['width'],
					'height'    => $image_meta['height'],
					'mime-type' => get_post_mime_type( $attachment_id ),
				),
			);
		}

		return $image_meta;

	}

	/**
	 * Replace the srcset candidates with Glide URLs for the requested size at
	 * each device pixel ratio (capped at the original width). Using `dpr` means
	 * the 1x candidate is the same cache entry as the <img> src, and the cache
	 * warmer can pre-build exactly this set.
	 */
	public function wp_calculate_image_srcset( $sources, $size_array, $image_src, $image_meta, $attachment_id ) {

		if ( ! is_array( $sources ) || ! wp_attachment_is_image( $attachment_id ) ) {
			return $sources;
		}

		if ( ! noon_focal_is_raster( $image_meta['file'] ?? $image_src ) ) {
			return $sources;
		}

		$w = (int) $size_array[0];
		$h = (int) $size_array[1];

		if ( $w < 1 || $h < 1 ) {
			return $sources;
		}

		$fit     = self::get_fit( $attachment_id );
		$max     = (int) ( $image_meta['width'] ?? 0 );
		$sources = array();

		foreach ( self::dprs() as $dpr ) {

			$width = (int) round( $w * $dpr );

			if ( $max > 0 && $width > $max ) {
				continue;
			}

			$params = array( 'w' => $w, 'h' => $h, 'fit' => $fit );
			if ( 1 != $dpr ) {
				$params['dpr'] = $dpr;
			}

			$sources[ $width ] = array(
				'url'        => noon_focal_glide_url( $attachment_id, $params ),
				'descriptor' => 'w',
				'value'      => $width,
			);

		}

		return $sources;

	}

	/* ---------------------------------------------------------------------
	 * Responsive sizes (noon_focal_add_image_size)
	 * ------------------------------------------------------------------ */

	/**
	 * For a responsive size without breakpoints, replace the dpr candidates
	 * with the size's width ladder (w descriptors). The filter only sees [w, h],
	 * so the size is identified by matching that box against each responsive
	 * size's resolved dimensions for this attachment; the first match wins.
	 */
	public function responsive_srcset( $sources, $size_array, $image_src, $image_meta, $attachment_id ) {

		if ( ! is_array( $sources ) || ! noon_focal_responsive_sizes() ) {
			return $sources;
		}

		$name = $this->responsive_size_for_box( $attachment_id, $size_array );

		if ( ! $name ) {
			return $sources;
		}

		$candidates = noon_focal_responsive_candidates( $attachment_id, $name );

		if ( ! $candidates ) {
			return $sources;
		}

		$fit     = self::get_fit( $attachment_id );
		$sources = array();

		foreach ( $candidates as $box ) {
			$sources[ $box['w'] ] = array(
				'url'        => noon_focal_glide_url( $attachment_id, array( 'w' => $box['w'], 'h' => $box['h'], 'fit' => $fit ) ),
				'descriptor' => 'w',
				'value'      => $box['w'],
			);
		}

		return $sources;

	}

	/**
	 * The configured sizes attribute of a responsive size, when it has one;
	 * otherwise core's default "(max-width: Wpx) 100vw, Wpx" stands. Only used
	 * when the caller passed no 'sizes' attr. wp_get_attachment_image() passes
	 * the [w, h] box here rather than the name, so both are accepted.
	 */
	public function responsive_sizes_attr( $sizes, $size, $image_src, $image_meta, $attachment_id ) {

		if ( is_array( $size ) ) {
			$size = $this->responsive_size_for_box( $attachment_id, $size );
		}

		$config = $size ? noon_focal_responsive_size( $size ) : null;

		return ( $config && '' !== $config['sizes'] ) ? $config['sizes'] : $sizes;

	}

	/**
	 * Wrap the <img> of a responsive size that has breakpoints in a <picture>,
	 * with a <source> per breakpoint at every dpr. The <img> keeps its base box
	 * and dpr srcset and serves viewports below the smallest breakpoint.
	 */
	public function picture_wrap( $html, $attachment_id, $size, $icon = false, $attr = array() ) {

		$config = noon_focal_responsive_size( $size );

		if ( ! $config || ! $config['breakpoints'] || ! is_string( $html ) || false === stripos( $html, '<img' ) ) {
			return $html;
		}

		if ( ! wp_attachment_is_image( $attachment_id ) || ! noon_focal_is_raster( get_post_meta( $attachment_id, '_wp_attached_file', true ) ) ) {
			return $html;
		}

		$sources = $this->picture_sources( $attachment_id, $config['breakpoints'] );

		return $sources ? '<picture>' . $sources . $html . '</picture>' : $html;

	}

	/**
	 * <source> tags for breakpoint boxes, largest viewport first so the browser
	 * takes the first matching media query.
	 */
	private function picture_sources( $attachment_id, array $breakpoints ) {

		$meta = wp_get_attachment_metadata( $attachment_id );
		$max  = (int) ( $meta['width'] ?? 0 );
		$fit  = self::get_fit( $attachment_id );
		$html = '';

		krsort( $breakpoints, SORT_NUMERIC );

		foreach ( $breakpoints as $min_width => $box ) {

			if ( $min_width < 1 ) {
				continue; // The 0 breakpoint is the <img> itself.
			}

			$dims = noon_focal_dimensions( $attachment_id, $box );

			if ( ! $dims || $dims['w'] < 1 || $dims['h'] < 1 ) {
				continue;
			}

			$srcset = array();

			foreach ( self::dprs() as $dpr ) {

				if ( 1 != $dpr && $max > 0 && round( $dims['w'] * $dpr ) > $max ) {
					continue;
				}

				$params = array( 'w' => $dims['w'], 'h' => $dims['h'], 'fit' => $fit );
				if ( 1 != $dpr ) {
					$params['dpr'] = $dpr;
				}

				$url = noon_focal_glide_url( $attachment_id, $params );

				if ( $url ) {
					$srcset[] = $url . ' ' . rtrim( rtrim( number_format( $dpr, 2, '.', '' ), '0' ), '.' ) . 'x';
				}

			}

			if ( ! $srcset ) {
				continue;
			}

			$html .= sprintf(
				'<source media="(min-width: %dpx)" srcset="%s" width="%d" height="%d">',
				(int) $min_width,
				esc_attr( implode( ', ', $srcset ) ),
				$dims['w'],
				$dims['h']
			);

		}

		return $html;

	}

	/**
	 * Name of the first responsive size (without breakpoints) whose resolved
	 * box for this attachment equals [w, h], or null.
	 */
	private function responsive_size_for_box( $attachment_id, $size_array ) {

		$w = (int) ( $size_array[0] ?? 0 );
		$h = (int) ( $size_array[1] ?? 0 );

		if ( $w < 1 || $h < 1 ) {
			return null;
		}

		foreach ( noon_focal_responsive_sizes() as $name => $config ) {

			if ( $config['breakpoints'] ) {
				continue;
			}

			$box = noon_focal_dimensions( $attachment_id, noon_focal_responsive_base( $name ) );

			if ( $box && $box['w'] === $w && $box['h'] === $h ) {
				return $name;
			}

		}

		return null;

	}

	/**
	 * Device pixel ratios offered in srcset and pre-built by the cache warmer.
	 */
	public static function dprs() {
		$dprs = apply_filters( 'noon_focal_dprs', array( 1, 1.5, 2 ) );
		return array_values( array_unique( array_map( 'floatval', (array) $dprs ) ) );
	}

	/* ---------------------------------------------------------------------
	 * Cache
	 * ------------------------------------------------------------------ */

	/**
	 * Runs on added/updated/deleted_post_meta, i.e. only after an actual change.
	 */
	public function focal_point_changed( $meta_id, $object_id, $meta_key ) {

		if ( self::META === $meta_key ) {
			self::delete_cache( $object_id );

			/**
			 * Fires after an attachment's renditions were purged because its focal
			 * point changed. The cache warmer uses this to rebuild them.
			 */
			do_action( 'noon_focal_cache_purged', (int) $object_id );
		}

	}

	public function delete_attachment( $post_id ) {
		self::delete_cache( $post_id );
	}

	public static function delete_cache( $attachment_id ) {

		$file = noon_focal_source_path( $attachment_id );

		if ( ! $file ) {
			return;
		}

		ServerFactory::create( array(
			'source' => NOON_FOCAL_UPLOADS_DIR,
			'cache'  => NOON_FOCAL_CACHE_DIR,
		) )->deleteCache( $file );

	}

}

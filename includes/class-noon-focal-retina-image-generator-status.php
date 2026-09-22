<?php
/**
 * "Is it working?" panel on Settings → Media: environment checks plus a live
 * round-trip that requests a signed rendition and inspects what came back.
 *
 * @package Noon_Focal_Retina_Image_Generator
 */

class Noon_Focal_Retina_Image_Generator_Status {

	const TEST_SIZE = 32;

	public function register() {
		// Priority 9 so this section renders above the warmer's "Image cache".
		add_action( 'admin_init', array( $this, 'settings_section' ), 9 );
	}

	public function settings_section() {

		add_settings_section(
			'noon_focal_status',
			__( 'Focal images — status', 'focal-point-images-smart-crop' ),
			array( $this, 'render' ),
			'media'
		);

	}

	/* ---------------------------------------------------------------------
	 * Checks
	 * ------------------------------------------------------------------ */

	/**
	 * Each check: ['label' => , 'state' => ok|warn|error|info, 'text' => , 'detail' => (optional, preformatted)].
	 */
	public function checks() {

		$server = $this->server();
		$checks = array();

		$checks[] = $this->check_live_request();
		$checks[] = $this->check_server( $server );
		$checks[] = 'nginx' === $server ? $this->check_nginx() : $this->check_htaccess( $server );
		$checks[] = $this->check_secret();
		$checks[] = $this->check_cache_dir();
		$checks[] = $this->check_image_library();
		$checks[] = $this->check_cron();
		$checks[] = $this->check_focal_coverage();

		return $checks;

	}

	/**
	 * apache | nginx | litespeed | other, from the SAPI's view of the front server.
	 */
	private function server() {

		$software = strtolower( $this->server_software() );

		foreach ( array( 'nginx', 'litespeed', 'apache' ) as $name ) {
			if ( false !== strpos( $software, $name ) ) {
				return $name;
			}
		}

		return 'other';

	}

	private function server_software() {
		return isset( $_SERVER['SERVER_SOFTWARE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['SERVER_SOFTWARE'] ) ) : '';
	}

	private function check_server( $server ) {

		$software = $this->server_software() ?: __( 'unknown', 'focal-point-images-smart-crop' );

		if ( 'nginx' === $server ) {
			return array(
				'label' => __( 'Web server', 'focal-point-images-smart-crop' ),
				'state' => 'info',
				/* translators: %s: server software */
				'text'  => sprintf( __( 'nginx (%s). .htaccess is ignored; the rewrite must live in the nginx server config.', 'focal-point-images-smart-crop' ), $software ),
			);
		}

		if ( 'other' === $server ) {
			return array(
				'label' => __( 'Web server', 'focal-point-images-smart-crop' ),
				'state' => 'warn',
				/* translators: %s: server software */
				'text'  => sprintf( __( 'Unrecognised server (%s). Check the live request result above.', 'focal-point-images-smart-crop' ), $software ),
			);
		}

		$mod_rewrite = function_exists( 'apache_get_modules' )
			? ( in_array( 'mod_rewrite', apache_get_modules(), true ) ? 'on' : 'off' )
			: 'unknown';

		return array(
			'label' => __( 'Web server', 'focal-point-images-smart-crop' ),
			'state' => 'off' === $mod_rewrite ? 'error' : 'ok',
			'text'  => sprintf(
				/* translators: 1: server software, 2: mod_rewrite state */
				__( '%1$s — mod_rewrite: %2$s', 'focal-point-images-smart-crop' ),
				$software,
				'unknown' === $mod_rewrite ? __( 'cannot detect from PHP (php-fpm); see live request', 'focal-point-images-smart-crop' ) : $mod_rewrite
			),
		);

	}

	private function check_htaccess( $server ) {

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$file   = get_home_path() . '.htaccess';
		$rules  = Noon_Focal_Retina_Image_Generator_Admin::htaccess_rules();
		$exists = is_readable( $file );
		$has    = $exists && false !== strpos( (string) file_get_contents( $file ), '/media.php' );

		if ( $has ) {
			return array(
				'label' => '.htaccess',
				'state' => 'ok',
				/* translators: %s: .htaccess path */
				'text'  => sprintf( __( 'Rewrite block present in %s', 'focal-point-images-smart-crop' ), $file ),
			);
		}

		$why = is_multisite()
			? __( 'WordPress does not write .htaccess on multisite, so the block has to be added by hand:', 'focal-point-images-smart-crop' )
			: __( 'Block missing. Re-saving Settings → Permalinks should write it; if the file is not writable, add it by hand:', 'focal-point-images-smart-crop' );

		return array(
			'label'  => '.htaccess',
			'state'  => 'error',
			/* translators: %s: .htaccess path */
			'text'   => ( $exists ? '' : sprintf( __( '%s not found. ', 'focal-point-images-smart-crop' ), $file ) ) . $why,
			'detail' => $rules,
		);

	}

	private function check_nginx() {

		$target = 'wp-content/plugins/' . basename( dirname( __DIR__ ) ) . '/media.php';

		$conf  = "# Focal Retina Image Generator: route upload URLs (?w=&h=, plus &s= when signed) to Glide.\n";
		$conf .= "# In the http {} block:\n";
		$conf .= 'map "$arg_direct:$arg_w:$arg_h:$arg_s" $noon_focal_glide {' . "\n";
		$conf .= "    default 0;\n";
		$conf .= '    "~^:[0-9]+:[0-9]+:[a-f0-9]*$" 1;' . "\n";
		$conf .= "}\n\n";
		$conf .= "# In the server {} block, before any generic static-file location:\n";
		$conf .= 'location ~* ^/(?:[_0-9a-zA-Z-]+/)?wp-content/uploads/.+\.[a-z0-9]+$ {' . "\n";
		$conf .= "    if (\$noon_focal_glide) {\n";
		$conf .= "        rewrite ^ /" . $target . " last;\n";
		$conf .= "    }\n";
		$conf .= "}\n";

		return array(
			'label'  => __( 'nginx config', 'focal-point-images-smart-crop' ),
			'state'  => 'info',
			'text'   => __( 'Cannot be inspected from PHP — rely on the live request result. If it is failing, add this to the nginx config and reload:', 'focal-point-images-smart-crop' ),
			'detail' => $conf,
		);

	}

	private function check_secret() {

		$file = noon_focal_secret_file();

		if ( ! defined( 'NOON_IMAGE_SECRET' ) ) {
			return array(
				'label' => __( 'Signing secret', 'focal-point-images-smart-crop' ),
				'state' => 'warn',
				/* translators: %s: secret mirror file path */
				'text'  => sprintf( __( 'None yet — images are served unsigned. %s could not be written; reload this page to retry.', 'focal-point-images-smart-crop' ), $file ),
			);
		}

		return array(
			'label' => __( 'Signing secret', 'focal-point-images-smart-crop' ),
			'state' => file_exists( $file ) ? 'ok' : 'warn',
			'text'  => file_exists( $file )
				/* translators: %s: secret mirror file path */
				? sprintf( __( 'Loaded from %s', 'focal-point-images-smart-crop' ), $file )
				: __( 'Set, but not yet mirrored for media.php to read — reload this page to write it.', 'focal-point-images-smart-crop' ),
		);

	}

	private function check_cache_dir() {

		$dir = NOON_FOCAL_CACHE_DIR;

		if ( ! is_dir( $dir ) ) {
			$parent = dirname( $dir );
			return array(
				'label' => __( 'Cache directory', 'focal-point-images-smart-crop' ),
				'state' => wp_is_writable( $parent ) ? 'info' : 'error',
				'text'  => wp_is_writable( $parent )
					/* translators: %s: cache directory */
					? sprintf( __( '%s does not exist yet; it is created on the first render.', 'focal-point-images-smart-crop' ), $dir )
					/* translators: 1: cache directory, 2: its parent directory */
					: sprintf( __( '%1$s does not exist and %2$s is not writable.', 'focal-point-images-smart-crop' ), $dir, $parent ),
			);
		}

		if ( ! wp_is_writable( $dir ) ) {
			return array(
				'label' => __( 'Cache directory', 'focal-point-images-smart-crop' ),
				'state' => 'error',
				/* translators: %s: cache directory */
				'text'  => sprintf( __( '%s is not writable by PHP.', 'focal-point-images-smart-crop' ), $dir ),
			);
		}

		list( $files, $bytes, $capped ) = $this->measure_dir( $dir, 5000 );

		return array(
			'label' => __( 'Cache directory', 'focal-point-images-smart-crop' ),
			'state' => 'ok',
			'text'  => sprintf(
				/* translators: 1: cache directory, 2: number of files, 3: total size */
				__( '%1$s — %2$s renditions, %3$s', 'focal-point-images-smart-crop' ),
				$dir,
				number_format_i18n( $files ) . ( $capped ? '+' : '' ),
				size_format( $bytes ) . ( $capped ? '+' : '' )
			),
		);

	}

	/**
	 * File count and size, stopping after $cap files so a huge cache does not
	 * stall the settings page.
	 */
	private function measure_dir( $dir, $cap ) {

		$files = 0;
		$bytes = 0;

		try {
			$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) );
			foreach ( $iterator as $file ) {
				if ( $file->isFile() ) {
					$files++;
					$bytes += $file->getSize();
					if ( $files >= $cap ) {
						return array( $files, $bytes, true );
					}
				}
			}
		} catch ( Exception $e ) {
			// Unreadable subdirectory; report what was counted.
		}

		return array( $files, $bytes, false );

	}

	private function check_image_library() {

		$parts = array();

		if ( class_exists( 'Imagick' ) ) {
			$parts[] = 'Imagick ' . ( phpversion( 'imagick' ) ?: '' );
		}
		if ( function_exists( 'gd_info' ) ) {
			$parts[] = 'GD ' . ( gd_info()['GD Version'] ?? '' );
		}

		if ( ! $parts ) {
			return array(
				'label' => __( 'Image library', 'focal-point-images-smart-crop' ),
				'state' => 'error',
				'text'  => __( 'Neither GD nor Imagick is available; Glide cannot render anything.', 'focal-point-images-smart-crop' ),
			);
		}

		$webp = noon_focal_webp_supported();

		return array(
			'label' => __( 'Image library', 'focal-point-images-smart-crop' ),
			'state' => $webp ? 'ok' : 'warn',
			'text'  => implode( ', ', $parts ) . ' — ' . ( $webp
				? __( 'WebP output supported', 'focal-point-images-smart-crop' )
				: __( 'no WebP support; browsers will get JPEG/PNG', 'focal-point-images-smart-crop' ) ),
		);

	}

	private function check_cron() {

		if ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ) {
			return array(
				'label' => __( 'WP-Cron', 'focal-point-images-smart-crop' ),
				'state' => 'warn',
				'text'  => __( 'DISABLE_WP_CRON is set. Background warming only runs if a system cron calls wp-cron.php (or "wp cron event run --due-now").', 'focal-point-images-smart-crop' ),
			);
		}

		return array(
			'label' => __( 'WP-Cron', 'focal-point-images-smart-crop' ),
			'state' => 'ok',
			'text'  => __( 'Enabled; uploads and focal-point changes are warmed in the background.', 'focal-point-images-smart-crop' ),
		);

	}

	private function check_focal_coverage() {

		$counts = (array) wp_count_attachments( 'image' );
		unset( $counts['trash'] );
		$total  = (int) array_sum( $counts );

		$set = ( new WP_Query( array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'post_mime_type' => 'image',
			'meta_key'       => Noon_Focal_Retina_Image_Generator_Admin::META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- a count for the status panel, run once per admin page view.
			'fields'         => 'ids',
			'posts_per_page' => 1,
			'no_found_rows'  => false,
		) ) )->found_posts;

		return array(
			'label' => __( 'Focal points', 'focal-point-images-smart-crop' ),
			'state' => 'info',
			'text'  => sprintf(
				/* translators: 1: images with a focal point, 2: total images */
				__( '%1$s of %2$s images have a focal point set; the rest crop from the centre.', 'focal-point-images-smart-crop' ),
				number_format_i18n( $set ),
				number_format_i18n( $total )
			),
		);

	}

	/**
	 * Request a tiny signed rendition of a real upload and work out from the
	 * response which layer, if any, is failing.
	 */
	private function check_live_request() {

		$label = __( 'Live request', 'focal-point-images-smart-crop' );

		$id = $this->sample_attachment();

		if ( ! $id ) {
			return array( 'label' => $label, 'state' => 'info', 'text' => __( 'No JPEG/PNG uploads to test with yet.', 'focal-point-images-smart-crop' ) );
		}

		$url = noon_focal_glide_url( $id, array( 'w' => self::TEST_SIZE, 'h' => self::TEST_SIZE, 'fit' => 'crop' ) );

		$response = wp_remote_get( $url, array(
			'timeout'     => 15,
			'redirection' => 0,
			'sslverify'   => false,
			'headers'     => array( 'Accept' => 'image/webp,image/*' ),
		) );

		$detail = $url;

		if ( is_wp_error( $response ) ) {
			return array(
				'label'  => $label,
				'state'  => 'warn',
				/* translators: %s: error message */
				'text'   => sprintf( __( 'Could not fetch from this server (%s). Loopback requests may be blocked; open the URL below in a browser to check by hand.', 'focal-point-images-smart-crop' ), $response->get_error_message() ),
				'detail' => $detail,
			);
		}

		$code = wp_remote_retrieve_response_code( $response );
		$type = wp_remote_retrieve_header( $response, 'content-type' );
		$body = wp_remote_retrieve_body( $response );

		switch ( true ) {

			case 200 === $code:
				$info = function_exists( 'getimagesizefromstring' ) ? @getimagesizefromstring( $body ) : false;

				if ( $info && self::TEST_SIZE === (int) $info[0] && self::TEST_SIZE === (int) $info[1] ) {
					return array(
						'label' => $label,
						'state' => 'ok',
						/* translators: 1: test size in pixels, 2: content type, 3: file size */
						'text'  => sprintf( __( 'Working. Rendered %1$d×%1$d as %2$s (%3$s).', 'focal-point-images-smart-crop' ), self::TEST_SIZE, $type, size_format( strlen( $body ) ) ),
					);
				}

				if ( $info ) {
					return array(
						'label'  => $label,
						'state'  => 'error',
						/* translators: 1: width, 2: height */
						'text'   => sprintf( __( 'Not working: the web server returned the original file (%1$d×%2$d) instead of a rendition. The rewrite rule is not active.', 'focal-point-images-smart-crop' ), $info[0], $info[1] ),
						'detail' => $detail,
					);
				}

				/* translators: %s: content type */
				return array( 'label' => $label, 'state' => 'error', 'text' => sprintf( __( '200 but not an image (%s). Something else is handling the request.', 'focal-point-images-smart-crop' ), $type ), 'detail' => $detail );

			case in_array( $code, array( 301, 302 ), true ):
				$to = wp_remote_retrieve_header( $response, 'location' );
				return array(
					'label'  => $label,
					'state'  => 'error',
					'text'   => false !== strpos( (string) $to, 'direct=true' )
						? __( 'media.php is reached but rejected the signature. The secret WordPress signs with differs from the one media.php reads — reload this page to re-mirror it.', 'focal-point-images-smart-crop' )
						/* translators: 1: HTTP status, 2: redirect target */
						: sprintf( __( 'Redirected (%1$d) to %2$s — another rule is intercepting the request.', 'focal-point-images-smart-crop' ), $code, $to ),
					'detail' => $detail,
				);

			case 404 === $code:
				return array( 'label' => $label, 'state' => 'error', 'text' => __( '404. Either the rewrite targets the wrong media.php path, or the source file is missing from the uploads directory.', 'focal-point-images-smart-crop' ), 'detail' => $detail );

			case 500 === $code:
				return array( 'label' => $label, 'state' => 'error', 'text' => __( '500 from media.php — see the PHP error log for a line starting "focal-point-images-smart-crop:".', 'focal-point-images-smart-crop' ), 'detail' => $detail );

			default:
				/* translators: %d: HTTP status */
				return array( 'label' => $label, 'state' => 'error', 'text' => sprintf( __( 'Unexpected HTTP %d.', 'focal-point-images-smart-crop' ), $code ), 'detail' => $detail );
		}

	}

	/**
	 * A recent JPEG/PNG whose original file actually exists on disk.
	 */
	private function sample_attachment() {

		$ids = get_posts( array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'post_mime_type' => array( 'image/jpeg', 'image/png' ),
			'posts_per_page' => 10,
			'orderby'        => 'ID',
			'order'          => 'DESC',
			'fields'         => 'ids',
		) );

		foreach ( $ids as $id ) {
			$file = noon_focal_source_path( $id );
			if ( $file && is_file( NOON_FOCAL_UPLOADS_DIR . '/' . $file ) ) {
				return (int) $id;
			}
		}

		return 0;

	}

	/* ---------------------------------------------------------------------
	 * Output
	 * ------------------------------------------------------------------ */

	public function render() {

		$colors = array(
			'ok'    => '#00a32a',
			'warn'  => '#dba617',
			'error' => '#d63638',
			'info'  => '#787c82',
		);

		echo '<table class="widefat striped" style="max-width:900px">';

		foreach ( $this->checks() as $check ) {

			printf(
				'<tr><td style="width:160px;white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;border-radius:50%%;background:%s;margin-right:6px;vertical-align:middle"></span><strong>%s</strong></td><td>%s%s</td></tr>',
				esc_attr( $colors[ $check['state'] ] ?? $colors['info'] ),
				esc_html( $check['label'] ),
				esc_html( $check['text'] ),
				empty( $check['detail'] ) ? '' : '<pre style="margin:8px 0 0;padding:8px;background:#f6f7f7;overflow:auto;font-size:12px">' . esc_html( $check['detail'] ) . '</pre>'
			);

		}

		echo '</table>';

		printf(
			'<p class="description">%s</p>',
			esc_html__( 'The live request is made from this server to itself each time this page loads.', 'focal-point-images-smart-crop' )
		);

	}

}

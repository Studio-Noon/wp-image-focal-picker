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
			__( 'Focal images — status', 'noon-focal-retina-image-generator' ),
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

		$software = strtolower( $_SERVER['SERVER_SOFTWARE'] ?? '' );

		foreach ( array( 'nginx', 'litespeed', 'apache' ) as $name ) {
			if ( false !== strpos( $software, $name ) ) {
				return $name;
			}
		}

		return 'other';

	}

	private function check_server( $server ) {

		$software = $_SERVER['SERVER_SOFTWARE'] ?? __( 'unknown', 'noon-focal-retina-image-generator' );

		if ( 'nginx' === $server ) {
			return array(
				'label' => __( 'Web server', 'noon-focal-retina-image-generator' ),
				'state' => 'info',
				'text'  => sprintf( __( 'nginx (%s). .htaccess is ignored; the rewrite must live in the nginx server config.', 'noon-focal-retina-image-generator' ), $software ),
			);
		}

		if ( 'other' === $server ) {
			return array(
				'label' => __( 'Web server', 'noon-focal-retina-image-generator' ),
				'state' => 'warn',
				'text'  => sprintf( __( 'Unrecognised server (%s). Check the live request result above.', 'noon-focal-retina-image-generator' ), $software ),
			);
		}

		$mod_rewrite = function_exists( 'apache_get_modules' )
			? ( in_array( 'mod_rewrite', apache_get_modules(), true ) ? 'on' : 'off' )
			: 'unknown';

		return array(
			'label' => __( 'Web server', 'noon-focal-retina-image-generator' ),
			'state' => 'off' === $mod_rewrite ? 'error' : 'ok',
			'text'  => sprintf(
				__( '%1$s — mod_rewrite: %2$s', 'noon-focal-retina-image-generator' ),
				$software,
				'unknown' === $mod_rewrite ? __( 'cannot detect from PHP (php-fpm); see live request', 'noon-focal-retina-image-generator' ) : $mod_rewrite
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
				'text'  => sprintf( __( 'Rewrite block present in %s', 'noon-focal-retina-image-generator' ), $file ),
			);
		}

		$why = is_multisite()
			? __( 'WordPress does not write .htaccess on multisite, so the block has to be added by hand:', 'noon-focal-retina-image-generator' )
			: __( 'Block missing. Re-saving Settings → Permalinks should write it; if the file is not writable, add it by hand:', 'noon-focal-retina-image-generator' );

		return array(
			'label'  => '.htaccess',
			'state'  => 'error',
			'text'   => ( $exists ? '' : sprintf( __( '%s not found. ', 'noon-focal-retina-image-generator' ), $file ) ) . $why,
			'detail' => $rules,
		);

	}

	private function check_nginx() {

		$target = 'wp-content/plugins/' . basename( dirname( __DIR__ ) ) . '/media.php';

		$conf  = "# Focal Retina Image Generator: route signed upload URLs (?w=&h=&s=) to Glide.\n";
		$conf .= "# In the http {} block:\n";
		$conf .= 'map "$arg_direct:$arg_w:$arg_h:$arg_s" $noon_focal_glide {' . "\n";
		$conf .= "    default 0;\n";
		$conf .= '    "~^:[0-9]+:[0-9]+:[a-f0-9]+$" 1;' . "\n";
		$conf .= "}\n\n";
		$conf .= "# In the server {} block, before any generic static-file location:\n";
		$conf .= 'location ~* ^/(?:[_0-9a-zA-Z-]+/)?wp-content/uploads/.+\.[a-z0-9]+$ {' . "\n";
		$conf .= "    if (\$noon_focal_glide) {\n";
		$conf .= "        rewrite ^ /" . $target . " last;\n";
		$conf .= "    }\n";
		$conf .= "}\n";

		return array(
			'label'  => __( 'nginx config', 'noon-focal-retina-image-generator' ),
			'state'  => 'info',
			'text'   => __( 'Cannot be inspected from PHP — rely on the live request result. If it is failing, add this to the nginx config and reload:', 'noon-focal-retina-image-generator' ),
			'detail' => $conf,
		);

	}

	private function check_secret() {

		$file = noon_focal_secret_file();

		if ( ! defined( 'NOON_IMAGE_SECRET' ) ) {
			return array(
				'label' => __( 'Signing secret', 'noon-focal-retina-image-generator' ),
				'state' => 'error',
				'text'  => sprintf( __( 'Not available. %s is missing or unreadable; reload this page to regenerate it.', 'noon-focal-retina-image-generator' ), $file ),
			);
		}

		return array(
			'label' => __( 'Signing secret', 'noon-focal-retina-image-generator' ),
			'state' => file_exists( $file ) ? 'ok' : 'warn',
			'text'  => file_exists( $file )
				? sprintf( __( 'Loaded from %s', 'noon-focal-retina-image-generator' ), $file )
				: __( 'Defined in wp-config.php only — media.php cannot see that, so signatures will not match. Remove the constant and let the plugin generate the file.', 'noon-focal-retina-image-generator' ),
		);

	}

	private function check_cache_dir() {

		$dir = NOON_FOCAL_CACHE_DIR;

		if ( ! is_dir( $dir ) ) {
			$parent = dirname( $dir );
			return array(
				'label' => __( 'Cache directory', 'noon-focal-retina-image-generator' ),
				'state' => wp_is_writable( $parent ) ? 'info' : 'error',
				'text'  => wp_is_writable( $parent )
					? sprintf( __( '%s does not exist yet; it is created on the first render.', 'noon-focal-retina-image-generator' ), $dir )
					: sprintf( __( '%1$s does not exist and %2$s is not writable.', 'noon-focal-retina-image-generator' ), $dir, $parent ),
			);
		}

		if ( ! wp_is_writable( $dir ) ) {
			return array(
				'label' => __( 'Cache directory', 'noon-focal-retina-image-generator' ),
				'state' => 'error',
				'text'  => sprintf( __( '%s is not writable by PHP.', 'noon-focal-retina-image-generator' ), $dir ),
			);
		}

		list( $files, $bytes, $capped ) = $this->measure_dir( $dir, 5000 );

		return array(
			'label' => __( 'Cache directory', 'noon-focal-retina-image-generator' ),
			'state' => 'ok',
			'text'  => sprintf(
				__( '%1$s — %2$s renditions, %3$s', 'noon-focal-retina-image-generator' ),
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
				'label' => __( 'Image library', 'noon-focal-retina-image-generator' ),
				'state' => 'error',
				'text'  => __( 'Neither GD nor Imagick is available; Glide cannot render anything.', 'noon-focal-retina-image-generator' ),
			);
		}

		$webp = noon_focal_webp_supported();

		return array(
			'label' => __( 'Image library', 'noon-focal-retina-image-generator' ),
			'state' => $webp ? 'ok' : 'warn',
			'text'  => implode( ', ', $parts ) . ' — ' . ( $webp
				? __( 'WebP output supported', 'noon-focal-retina-image-generator' )
				: __( 'no WebP support; browsers will get JPEG/PNG', 'noon-focal-retina-image-generator' ) ),
		);

	}

	private function check_cron() {

		if ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ) {
			return array(
				'label' => __( 'WP-Cron', 'noon-focal-retina-image-generator' ),
				'state' => 'warn',
				'text'  => __( 'DISABLE_WP_CRON is set. Background warming only runs if a system cron calls wp-cron.php (or "wp cron event run --due-now").', 'noon-focal-retina-image-generator' ),
			);
		}

		return array(
			'label' => __( 'WP-Cron', 'noon-focal-retina-image-generator' ),
			'state' => 'ok',
			'text'  => __( 'Enabled; uploads and focal-point changes are warmed in the background.', 'noon-focal-retina-image-generator' ),
		);

	}

	private function check_focal_coverage() {

		global $wpdb;

		$total = (int) $wpdb->get_var(
			"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_mime_type IN ('image/jpeg','image/png','image/gif','image/webp')"
		);
		$set   = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(DISTINCT p.ID) FROM {$wpdb->posts} p INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = %s WHERE p.post_type = 'attachment'",
			Noon_Focal_Retina_Image_Generator_Admin::META
		) );

		return array(
			'label' => __( 'Focal points', 'noon-focal-retina-image-generator' ),
			'state' => 'info',
			'text'  => sprintf(
				__( '%1$s of %2$s images have a focal point set; the rest crop from the centre.', 'noon-focal-retina-image-generator' ),
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

		$label = __( 'Live request', 'noon-focal-retina-image-generator' );

		if ( ! defined( 'NOON_IMAGE_SECRET' ) ) {
			return array( 'label' => $label, 'state' => 'error', 'text' => __( 'Skipped: no signing secret.', 'noon-focal-retina-image-generator' ) );
		}

		$id = $this->sample_attachment();

		if ( ! $id ) {
			return array( 'label' => $label, 'state' => 'info', 'text' => __( 'No JPEG/PNG uploads to test with yet.', 'noon-focal-retina-image-generator' ) );
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
				'text'   => sprintf( __( 'Could not fetch from this server (%s). Loopback requests may be blocked; open the URL below in a browser to check by hand.', 'noon-focal-retina-image-generator' ), $response->get_error_message() ),
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
						'text'  => sprintf( __( 'Working. Rendered %1$d×%1$d as %2$s (%3$s).', 'noon-focal-retina-image-generator' ), self::TEST_SIZE, $type, size_format( strlen( $body ) ) ),
					);
				}

				if ( $info ) {
					return array(
						'label'  => $label,
						'state'  => 'error',
						'text'   => sprintf( __( 'Not working: the web server returned the original file (%1$d×%2$d) instead of a rendition. The rewrite rule is not active.', 'noon-focal-retina-image-generator' ), $info[0], $info[1] ),
						'detail' => $detail,
					);
				}

				return array( 'label' => $label, 'state' => 'error', 'text' => sprintf( __( '200 but not an image (%s). Something else is handling the request.', 'noon-focal-retina-image-generator' ), $type ), 'detail' => $detail );

			case in_array( $code, array( 301, 302 ), true ):
				$to = wp_remote_retrieve_header( $response, 'location' );
				return array(
					'label'  => $label,
					'state'  => 'error',
					'text'   => false !== strpos( (string) $to, 'direct=true' )
						? __( 'media.php is reached but rejected the signature. The secret WordPress signs with differs from the one media.php reads (wp-content/noon-image-secret.php).', 'noon-focal-retina-image-generator' )
						: sprintf( __( 'Redirected (%1$d) to %2$s — another rule is intercepting the request.', 'noon-focal-retina-image-generator' ), $code, $to ),
					'detail' => $detail,
				);

			case 404 === $code:
				return array( 'label' => $label, 'state' => 'error', 'text' => __( '404. Either the rewrite targets the wrong media.php path, or the source file is missing from the uploads directory.', 'noon-focal-retina-image-generator' ), 'detail' => $detail );

			case 503 === $code:
				return array( 'label' => $label, 'state' => 'error', 'text' => __( '503 from media.php: it cannot read the signing secret file.', 'noon-focal-retina-image-generator' ), 'detail' => $detail );

			case 500 === $code:
				return array( 'label' => $label, 'state' => 'error', 'text' => __( '500 from media.php — see the PHP error log for a line starting "noon-focal-retina-image-generator:".', 'noon-focal-retina-image-generator' ), 'detail' => $detail );

			default:
				return array( 'label' => $label, 'state' => 'error', 'text' => sprintf( __( 'Unexpected HTTP %d.', 'noon-focal-retina-image-generator' ), $code ), 'detail' => $detail );
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
			esc_html__( 'The live request is made from this server to itself each time this page loads.', 'noon-focal-retina-image-generator' )
		);

	}

}

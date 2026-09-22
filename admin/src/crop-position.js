/**
 * CSS object-position that reproduces Glide's `fit=crop-X-Y` for an image
 * shown in a box with `object-fit: cover`.
 *
 * Glide scales the image to cover the box, then offsets the crop so the focal
 * point sits at the centre, clamped to the image edges (Size::resolveCropOffset).
 * object-position: P% aligns the image's P% point with the box's P% point, i.e.
 * offset = P% × (scaled − box), so the same clamp expressed as a percentage is
 * (scaled × f − box / 2) / (scaled − box). Only the ratios matter, so this holds
 * at any preview scale.
 *
 * @param {number} imgW  Original width.
 * @param {number} imgH  Original height.
 * @param {number} boxW  Crop box width.
 * @param {number} boxH  Crop box height.
 * @param {number} fx    Focal x, 0–1 from the left.
 * @param {number} fy    Focal y, 0–1 from the top.
 * @return {{x: number, y: number}} Percentages for object-position.
 */
export function cropPosition( imgW, imgH, boxW, boxH, fx, fy ) {
	if ( ! imgW || ! imgH || ! boxW || ! boxH ) {
		return { x: fx * 100, y: fy * 100 };
	}

	const scale = Math.max( boxW / imgW, boxH / imgH );
	const scaledW = imgW * scale;
	const scaledH = imgH * scale;

	const axis = ( scaled, box, f ) => {
		const slack = scaled - box;
		if ( slack <= 0.5 ) {
			return 50;
		}
		const p = ( scaled * f - box / 2 ) / slack;
		return Math.min( 1, Math.max( 0, p ) ) * 100;
	};

	return {
		x: axis( scaledW, boxW, fx ),
		y: axis( scaledH, boxH, fy ),
	};
}

/**
 * The part of the image Glide keeps for `fit=crop-X-Y`, as fractions of the
 * image (0–1). Same scale-to-cover and clamped offset as cropPosition(), so
 * the two always agree.
 *
 * @param {number} imgW  Original width.
 * @param {number} imgH  Original height.
 * @param {number} boxW  Crop box width.
 * @param {number} boxH  Crop box height.
 * @param {number} fx    Focal x, 0–1 from the left.
 * @param {number} fy    Focal y, 0–1 from the top.
 * @return {{x: number, y: number, w: number, h: number}} Fractions of the image.
 */
export function cropRect( imgW, imgH, boxW, boxH, fx, fy ) {
	if ( ! imgW || ! imgH || ! boxW || ! boxH ) {
		return { x: 0, y: 0, w: 1, h: 1 };
	}

	const scale = Math.max( boxW / imgW, boxH / imgH );
	const w = Math.min( 1, boxW / scale / imgW );
	const h = Math.min( 1, boxH / scale / imgH );

	return {
		x: Math.min( 1 - w, Math.max( 0, fx - w / 2 ) ),
		y: Math.min( 1 - h, Math.max( 0, fy - h / 2 ) ),
		w,
		h,
	};
}

/**
 * Boxes to preview, as localized by the plugin (window.noonFocalPreview.sizes).
 *
 * @return {Array<{label: string, w: number, h: number}>}
 */
export function previewSizes() {
	const sizes = window.noonFocalPreview?.sizes;
	return Array.isArray( sizes ) ? sizes.filter( ( s ) => s && s.w > 0 && s.h > 0 ) : [];
}

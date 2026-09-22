/**
 * Where detected faces land in each cropped size. Faces and crops are both
 * fractions of the image (0–1 from the top-left), so no pixel sizes are needed.
 *
 * Each face has a padded box (with headroom, the one crops should keep) and
 * `raw`, the box as detected. A crop that keeps the padded box is "kept"; one
 * that trims the padding but not the face itself is "tight"; one that cuts
 * through the face is "cut", which looks worse than leaving it out entirely.
 */
import { cropRect } from '../crop-position';

const KEPT = 0.85; // of the padded box
const INTACT = 0.95; // of the raw face
const OUT = 0.05;

/**
 * Fraction of a box that lies inside a crop.
 *
 * @param {{x: number, y: number, w: number, h: number}} box
 * @param {{x: number, y: number, w: number, h: number}} crop
 * @return {number} 0–1.
 */
export function coverage( box, crop ) {
	const area = box.w * box.h;
	if ( area <= 0 ) {
		return 0;
	}
	const w = Math.min( box.x + box.w, crop.x + crop.w ) - Math.max( box.x, crop.x );
	const h = Math.min( box.y + box.h, crop.y + crop.h ) - Math.max( box.y, crop.y );
	return w > 0 && h > 0 ? ( w * h ) / area : 0;
}

/**
 * How a crop treats one face.
 *
 * @param {Object} face  Padded box with `raw`.
 * @param {Object} crop
 * @return {'kept'|'tight'|'cut'|'out'}
 */
export function faceState( face, crop ) {
	if ( coverage( face, crop ) >= KEPT ) {
		return 'kept';
	}
	const raw = coverage( face.raw || face, crop );
	if ( raw >= INTACT ) {
		return 'tight';
	}
	return raw <= OUT ? 'out' : 'cut';
}

/**
 * How one crop box treats the faces for a focal point.
 *
 * @param {Array}  faces
 * @param {number} imgW
 * @param {number} imgH
 * @param {{w: number, h: number}} size  Crop box.
 * @param {{x: number, y: number}} focus 0–1.
 * @return {{kept: number, tight: number, cut: number, out: number}} Face counts.
 */
export function faceCoverage( faces, imgW, imgH, size, focus ) {
	const crop = cropRect( imgW, imgH, size.w, size.h, focus.x, focus.y );
	const result = { kept: 0, tight: 0, cut: 0, out: 0 };
	faces.forEach( ( face ) => {
		result[ faceState( face, crop ) ]++;
	} );
	return result;
}

/**
 * Score for one face in one crop: 1 kept, 0.6 tight, 0 out of frame, and a
 * cut face between −0.75 and +0.15 depending on how much of it survives — so
 * leaving a face out beats slicing through it unless nearly all of it shows.
 *
 * @param {Object} face
 * @param {Object} crop
 * @return {number}
 */
export function faceScore( face, crop ) {
	switch ( faceState( face, crop ) ) {
		case 'kept':
			return 1;
		case 'tight':
			return 0.6;
		case 'out':
			return 0;
		default:
			return coverage( face.raw || face, crop ) - 0.8;
	}
}

/**
 * Pick the focal point that keeps the most faces whole across every cropped
 * size. Pure: no DOM, no detector.
 */
import { cropRect } from '../crop-position';
import { faceScore } from './geometry';

const GRID = 50; // candidates per axis
const PULL = 0.05; // tie-breaker: prefer the candidate nearest the faces' centroid

/**
 * Area-weighted centre of the faces — the natural point when no size is
 * registered, and the tie-breaker between points that crop identically.
 *
 * @param {Array} faces
 * @return {{x: number, y: number}}
 */
export function faceCentroid( faces ) {
	let x = 0;
	let y = 0;
	let total = 0;
	faces.forEach( ( f ) => {
		const w = Math.sqrt( f.w * f.h );
		x += ( f.x + f.w / 2 ) * w;
		y += ( f.y + f.h / 2 ) * w;
		total += w;
	} );
	return total ? { x: x / total, y: y / total } : { x: 0.5, y: 0.5 };
}

/**
 * @param {Array}  faces  Padded face boxes, fractions of the image.
 * @param {number} imgW
 * @param {number} imgH
 * @param {Array<{w: number, h: number}>} sizes Crop boxes to satisfy.
 * @return {{x: number, y: number}|null} Suggested focal point, 0–1, or null without faces.
 */
export function suggestFocus( faces, imgW, imgH, sizes ) {
	if ( ! faces.length ) {
		return null;
	}

	const anchor = faceCentroid( faces );
	const boxes = ( sizes || [] ).filter( ( s ) => s.w > 0 && s.h > 0 );

	if ( ! boxes.length || ! imgW || ! imgH ) {
		return anchor;
	}

	// Bigger faces matter more, but a small face still counts.
	const weights = faces.map( ( f ) => Math.sqrt( f.w * f.h ) );
	const sum = weights.reduce( ( a, b ) => a + b, 0 ) || 1;

	const score = ( p ) => {
		let total = 0;
		boxes.forEach( ( size ) => {
			const crop = cropRect( imgW, imgH, size.w, size.h, p.x, p.y );
			faces.forEach( ( face, i ) => {
				total += ( weights[ i ] / sum ) * faceScore( face, crop );
			} );
		} );
		return total - PULL * Math.hypot( p.x - anchor.x, p.y - anchor.y );
	};

	let best = anchor;
	let bestScore = score( anchor );

	for ( let i = 0; i <= GRID; i++ ) {
		for ( let j = 0; j <= GRID; j++ ) {
			const p = { x: i / GRID, y: j / GRID };
			const s = score( p );
			if ( s > bestScore ) {
				best = p;
				bestScore = s;
			}
		}
	}

	return { x: Number( best.x.toFixed( 4 ) ), y: Number( best.y.toFixed( 4 ) ) };
}

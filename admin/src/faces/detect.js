/**
 * Face detection in the browser, to suggest a focal point.
 *
 * @vladmandic/face-api (TensorFlow.js + TinyFaceDetector, ~1.5 MB) is only
 * fetched on first use, as its own chunk, with the weights served from the
 * plugin's admin/build/models directory. The image never leaves the browser.
 */

// Longest side the image is drawn at before detection: TinyFaceDetector
// resizes to its input size anyway, so anything larger is wasted memory.
const MAX_SIDE = 1280;

// Two passes: the small input catches large faces cleanly, the large one
// finds small faces in group shots. Duplicates are merged by overlap.
const INPUT_SIZES = [ 512, 1280 ];
const SCORE_THRESHOLD = 0.45;
const MERGE_IOU = 0.4;

// Headroom around a detected face so a crop keeps hair and chin, not just
// eyes to mouth: fractions of the box's own size.
const PAD = { x: 0.25, top: 0.35, bottom: 0.15 };

let loading = null;

/**
 * Whether the plugin has told us where the weights are.
 *
 * @return {boolean}
 */
export function faceDetectionAvailable() {
	return Boolean( window.noonFocalPreview?.faces && window.noonFocalPreview?.models );
}

function load() {
	if ( ! loading ) {
		loading = ( async () => {
			const faceapi = await import( /* webpackChunkName: "face-api" */ '@vladmandic/face-api' );
			await faceapi.tf.ready();
			await faceapi.nets.tinyFaceDetector.loadFromUri( window.noonFocalPreview.models );
			return faceapi;
		} )().catch( ( error ) => {
			loading = null;
			throw error;
		} );
	}
	return loading;
}

function loadImage( src ) {
	return new Promise( ( resolve, reject ) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve( img );
		img.onerror = () => reject( new Error( 'The image could not be loaded for detection.' ) );
		img.src = src;
	} );
}

function toCanvas( img ) {
	const scale = Math.min( 1, MAX_SIDE / Math.max( img.naturalWidth, img.naturalHeight ) );
	const canvas = document.createElement( 'canvas' );
	canvas.width = Math.max( 32, Math.round( img.naturalWidth * scale ) );
	canvas.height = Math.max( 32, Math.round( img.naturalHeight * scale ) );
	canvas.getContext( '2d' ).drawImage( img, 0, 0, canvas.width, canvas.height );
	return canvas;
}

function iou( a, b ) {
	const w = Math.min( a.x + a.w, b.x + b.w ) - Math.max( a.x, b.x );
	const h = Math.min( a.y + a.h, b.y + b.h ) - Math.max( a.y, b.y );
	if ( w <= 0 || h <= 0 ) {
		return 0;
	}
	const inter = w * h;
	return inter / ( a.w * a.h + b.w * b.h - inter );
}

function merge( boxes ) {
	const kept = [];
	boxes
		.sort( ( a, b ) => b.score - a.score )
		.forEach( ( box ) => {
			if ( ! kept.some( ( k ) => iou( k, box ) >= MERGE_IOU ) ) {
				kept.push( box );
			}
		} );
	return kept;
}

function pad( box ) {
	const x0 = Math.max( 0, box.x - box.w * PAD.x );
	const y0 = Math.max( 0, box.y - box.h * PAD.top );
	const x1 = Math.min( 1, box.x + box.w * ( 1 + PAD.x ) );
	const y1 = Math.min( 1, box.y + box.h * ( 1 + PAD.bottom ) );
	return {
		x: x0,
		y: y0,
		w: x1 - x0,
		h: y1 - y0,
		raw: { x: box.x, y: box.y, w: box.w, h: box.h },
		score: box.score,
	};
}

/**
 * Detect faces in an image.
 *
 * @param {string} src Image URL (same origin, or served with CORS headers).
 * @return {Promise<Array<{x: number, y: number, w: number, h: number, raw: Object, score: number}>>}
 *         Padded boxes as fractions of the image, largest first; `raw` is the
 *         box as detected, for drawing.
 */
export async function detectFaces( src ) {
	const [ faceapi, img ] = await Promise.all( [ load(), loadImage( src ) ] );
	const canvas = toCanvas( img );
	const longest = Math.max( canvas.width, canvas.height );

	// Input sizes must be multiples of 32; no point exceeding the image.
	const inputSizes = [ ...new Set(
		INPUT_SIZES.map( ( s ) => Math.max( 128, Math.min( s, Math.floor( longest / 32 ) * 32 ) ) )
	) ];

	const boxes = [];
	for ( const inputSize of inputSizes ) {
		const options = new faceapi.TinyFaceDetectorOptions( { inputSize, scoreThreshold: SCORE_THRESHOLD } );
		const detections = await faceapi.detectAllFaces( canvas, options );
		detections.forEach( ( d ) => {
			const b = d.relativeBox;
			boxes.push( { x: b.x, y: b.y, w: b.width, h: b.height, score: d.score } );
		} );
	}

	return merge( boxes )
		.map( pad )
		.sort( ( a, b ) => b.w * b.h - a.w * a.h );
}

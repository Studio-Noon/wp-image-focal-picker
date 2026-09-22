import { __, sprintf } from '@wordpress/i18n';

export function shapeOptions() {
	return [
		{ value: 'all', label: __( 'All shapes', 'focal-point-images-smart-crop' ) },
		{ value: 'landscape', label: __( 'Landscape', 'focal-point-images-smart-crop' ) },
		{ value: 'portrait', label: __( 'Portrait', 'focal-point-images-smart-crop' ) },
		{ value: 'square', label: __( 'Square', 'focal-point-images-smart-crop' ) },
	];
}

export function matchesSize( size, query = '', shape = 'all' ) {
	const orientation = size.w > size.h ? 'landscape' : size.w < size.h ? 'portrait' : 'square';
	const normalize = ( value ) => String( value ).toLowerCase().replace( /×/g, 'x' ).replace( /\s*x\s*(?=\d)/g, 'x' );
	const terms = normalize( query ).trim().split( /\s+/ ).filter( Boolean );
	const searchable = normalize( `${ size.label } ${ size.w }x${ size.h } ${ size.w } ${ size.h }` );
	return ( shape === 'all' || shape === orientation ) && terms.every( ( term ) => searchable.includes( term ) );
}

export function resultsMessage( count, total ) {
	return sprintf(
		/* translators: 1: visible image sizes, 2: total image sizes. */
		__( '%1$d of %2$d sizes', 'focal-point-images-smart-crop' ),
		count,
		total
	);
}

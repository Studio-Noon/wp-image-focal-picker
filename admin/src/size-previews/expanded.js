import { __, sprintf } from '@wordpress/i18n';

let previewId = 0;

/** Open a read-only crop preview inside the editor's existing focus boundary. */
export function openExpandedPreview( { src, size, position, trigger } ) {
	const dialog = document.createElement( 'dialog' );
	dialog.className = 'noon-focal-preview-lightbox';
	const titleId = `noon-focal-preview-title-${ ++previewId }`;
	dialog.setAttribute( 'aria-labelledby', titleId );

	const header = document.createElement( 'header' );
	header.className = 'noon-focal-preview-lightbox__header';
	const heading = document.createElement( 'div' );
	const title = document.createElement( 'h2' );
	title.id = titleId;
	title.textContent = size.label;
	const dimensions = document.createElement( 'p' );
	dimensions.textContent = `${ size.w } × ${ size.h } px`;
	heading.append( title, dimensions );
	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'button';
	close.textContent = __( 'Close preview', 'focal-point-images-smart-crop' );
	close.autofocus = true;
	header.append( heading, close );

	const stage = document.createElement( 'div' );
	stage.className = 'noon-focal-preview-lightbox__stage';
	const crop = document.createElement( 'div' );
	crop.className = 'noon-focal-preview-lightbox__crop';
	crop.style.aspectRatio = `${ size.w } / ${ size.h }`;
	crop.style.setProperty( '--preview-ratio', size.w / size.h );
	const image = document.createElement( 'img' );
	image.src = src;
	image.alt = sprintf(
		/* translators: %s: image size name. */
		__( '%s crop preview', 'focal-point-images-smart-crop' ),
		size.label
	);
	image.draggable = false;
	image.style.objectPosition = position;
	crop.appendChild( image );
	stage.appendChild( crop );
	dialog.append( header, stage );

	const dismiss = () => {
		if ( ! dialog.isConnected ) return;
		dialog.close();
		dialog.remove();
		if ( trigger.isConnected ) trigger.focus( { preventScroll: true } );
	};
	close.addEventListener( 'click', dismiss );
	dialog.addEventListener( 'cancel', ( event ) => {
		event.preventDefault();
		dismiss();
	} );
	// The underlying WordPress/jQuery dialog must not handle this Escape key.
	dialog.addEventListener( 'keydown', ( event ) => {
		if ( event.key === 'Escape' ) {
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		}
	} );

	// Keep the native modal within the parent editor's focus trap. The top
	// layer lets it escape the editor's clipping and scrolling containers.
	trigger.closest( '.noon-focal-size-previews' ).appendChild( dialog );
	dialog.showModal();
	return dismiss;
}

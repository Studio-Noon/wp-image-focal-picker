import { FocusPicker } from 'image-focus';
import { cropPosition, previewSizes } from '../crop-position';
import './style.scss';

/**
 * "Edit Focal Point" button in the attachment details (media modal and the
 * attachment edit screen). Opens a jQuery UI dialog with an image-focus picker
 * and writes the result into the hidden noon_focal_point_x/_y fields, which
 * WordPress saves through attachment_fields_to_save.
 */
( function ( $ ) {
	let dialog = null;

	/**
	 * Render one thumbnail per cropped size into the dialog and return a
	 * function that repositions them for a focal point (0–1 from top-left).
	 */
	function renderPreviews( container, dialogEl ) {
		const host = dialogEl.find( '.Noon_Focal_Retina_Image_Generator_Previews' );
		const grid = host.find( '.previews' )[ 0 ];
		const src = host.data( 'src' );
		const imgW = parseInt( container.data( 'width' ), 10 ) || 0;
		const imgH = parseInt( container.data( 'height' ), 10 ) || 0;
		const sizes = previewSizes();

		if ( ! grid || ! src || ! sizes.length ) {
			host.remove();
			return () => {};
		}

		const items = sizes.map( ( size ) => {
			const figure = document.createElement( 'figure' );
			figure.className = 'noon-focal-size-previews__item';
			figure.style.setProperty( '--r', ( size.w / size.h ).toFixed( 3 ) );

			const box = document.createElement( 'span' );
			box.className = 'noon-focal-size-previews__box';
			box.style.aspectRatio = `${ size.w } / ${ size.h }`;

			const img = document.createElement( 'img' );
			img.src = src;
			img.alt = '';
			img.draggable = false;

			const caption = document.createElement( 'figcaption' );
			const label = document.createElement( 'strong' );
			label.textContent = size.label;
			caption.appendChild( label );
			caption.appendChild( document.createTextNode( `${ size.w }×${ size.h }` ) );

			box.appendChild( img );
			figure.appendChild( box );
			figure.appendChild( caption );
			grid.appendChild( figure );

			return { size, img };
		} );

		return ( fx, fy ) => {
			items.forEach( ( { size, img } ) => {
				const pos = cropPosition( imgW, imgH, size.w, size.h, fx, fy );
				img.style.objectPosition = `${ pos.x }% ${ pos.y }%`;
			} );
		};
	}

	function closeDialog() {
		if ( dialog ) {
			dialog.dialog( 'destroy' ).remove();
			dialog = null;
		}
	}

	function openDialog( button ) {
		closeDialog();

		const container = $( button ).closest( '.Noon_Focal_Retina_Container' );
		const id = $( button ).data( 'attachment-id' );
		const inputX = document.querySelector( `input[name="attachments[${ id }][noon_focal_point_x]"]` );
		const inputY = document.querySelector( `input[name="attachments[${ id }][noon_focal_point_y]"]` );

		if ( ! inputX || ! inputY ) {
			return;
		}

		// Clone so the dialog can be destroyed without losing the template.
		dialog = container.find( '.Noon_Focal_Retina_Image_Generator_Template' ).clone().removeClass( 'hidden' );

		const initial = { x: inputX.value, y: inputY.value };

		dialog.dialog( {
			title: 'Focal Point',
			dialogClass: 'wp-dialog noon-focal-dialog',
			classes: { 'ui-dialog': 'wp-dialog noon-focal-dialog' },
			autoOpen: true,
			draggable: false,
			width: 'auto',
			modal: true,
			resizable: false,
			closeOnEscape: true,
			position: { my: 'center', at: 'center', of: window },
			create() {
				$( '.ui-dialog-titlebar-close' ).addClass( 'ui-button' );
			},
			open() {
				$( '.ui-widget-overlay' ).one( 'click', closeDialog );

				const img = dialog.find( '.Noon_Focal_Retina_Image_Generator_Wrapper img' )[ 0 ];
				const updatePreviews = renderPreviews( container, dialog );

				updatePreviews( parseFloat( initial.x ), parseFloat( initial.y ) );

				// image-focus uses -1..1 with y pointing up; WordPress meta uses 0..1 from the top-left.
				new FocusPicker( img, {
					focus: { x: ( initial.x - 0.5 ) * 2, y: ( initial.y - 0.5 ) * -2 },
					debounceTime: 17,
					onChange( focus ) {
						const x = focus.x / 2 + 0.5;
						const y = focus.y / -2 + 0.5;
						inputX.value = x.toFixed( 4 );
						inputY.value = y.toFixed( 4 );
						updatePreviews( x, y );
					},
				} );

				dialog.find( '.actions .cancel' ).on( 'click', () => {
					inputX.value = initial.x;
					inputY.value = initial.y;
					closeDialog();
				} );

				dialog.find( '.actions .apply' ).on( 'click', () => {
					const icon = container.find( '#focal-preview-icon' )[ 0 ];
					if ( icon ) {
						icon.style.left = inputX.value * 100 + '%';
						icon.style.top = inputY.value * 100 + '%';
					}
					// Triggers WordPress' attachment-details save.
					$( inputX ).trigger( 'change' );
					$( inputY ).trigger( 'change' );
					closeDialog();
				} );
			},
			close: closeDialog,
		} );
	}

	$( document ).on( 'click', '.noon_edit_focalpoint', function ( event ) {
		event.preventDefault();
		openDialog( this );
	} );

	$( document ).ready( () => {
		if ( window.wp?.media?.view?.Modal ) {
			wp.media.view.Modal.prototype.on( 'close', closeDialog );
		}
	} );
} )( jQuery );

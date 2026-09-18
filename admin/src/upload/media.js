import { FocusPicker } from 'image-focus';
import './style.scss';

/**
 * "Edit Focal Point" button in the attachment details (media modal and the
 * attachment edit screen). Opens a jQuery UI dialog with an image-focus picker
 * and writes the result into the hidden noon_focal_point_x/_y fields, which
 * WordPress saves through attachment_fields_to_save.
 */
( function ( $ ) {
	let dialog = null;

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
			title: 'Focal Point Picker',
			dialogClass: 'wp-dialog',
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

				// image-focus uses -1..1 with y pointing up; WordPress meta uses 0..1 from the top-left.
				new FocusPicker( img, {
					focus: { x: ( initial.x - 0.5 ) * 2, y: ( initial.y - 0.5 ) * -2 },
					debounceTime: 17,
					onChange( focus ) {
						inputX.value = ( focus.x / 2 + 0.5 ).toFixed( 4 );
						inputY.value = ( focus.y / -2 + 0.5 ).toFixed( 4 );
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

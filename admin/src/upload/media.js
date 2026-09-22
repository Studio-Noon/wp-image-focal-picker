import { FocusPicker } from 'image-focus';
import { __, sprintf } from '@wordpress/i18n';
import { cropPosition, previewSizes } from '../crop-position';
import { matchesSize, shapeOptions, resultsMessage } from '../size-previews/filters';
import { openExpandedPreview } from '../size-previews/expanded';
import { faceCoverage } from '../faces/geometry';
import { suggestFocus } from '../faces/suggest';
import { detectFaces, faceDetectionAvailable } from '../faces/detect';
import { facesMessage, faceBadge, facesSelectionMessage } from '../faces/messages';
import './style.scss';

/**
 * "Edit Focal Point" button in the attachment details (media modal and the
 * attachment edit screen). Opens a jQuery UI dialog with an image-focus picker
 * and writes the result into the hidden noon_focal_point_x/_y fields, which
 * WordPress saves through attachment_fields_to_save.
 */
( function ( $ ) {
	let dialog = null;
	let dismissPreview = null;

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

			const box = document.createElement( 'span' );
			box.className = 'noon-focal-size-previews__box';
			box.style.aspectRatio = `${ size.w } / ${ size.h }`;
			box.style.maxWidth = `${ 220 * size.w / size.h }px`;

			const img = document.createElement( 'img' );
			img.src = src;
			img.alt = '';
			img.draggable = false;

			const badge = document.createElement( 'span' );
			badge.hidden = true;

			const caption = document.createElement( 'figcaption' );
			const label = document.createElement( 'strong' );
			label.textContent = size.label;
			caption.appendChild( label );
			caption.appendChild( document.createTextNode( `${ size.w }×${ size.h }` ) );
			const expand = document.createElement( 'button' );
			expand.type = 'button';
			expand.className = 'button-link noon-focal-size-previews__expand';
			expand.textContent = __( 'Expand preview', 'focal-point-images-smart-crop' );
			expand.setAttribute( 'aria-haspopup', 'dialog' );
			expand.setAttribute( 'aria-label', sprintf(
				/* translators: %s: image size name. */
				__( 'Expand %s preview', 'focal-point-images-smart-crop' ),
				size.label
			) );
			expand.addEventListener( 'click', () => {
				dismissPreview?.();
				dismissPreview = openExpandedPreview( { src, size, position: img.style.objectPosition, trigger: expand } );
			} );
			caption.appendChild( expand );

			box.appendChild( img );
			box.appendChild( badge );
			figure.appendChild( box );
			figure.appendChild( caption );
			grid.appendChild( figure );

			return { size, img, badge, figure };
		} );

		const filters = document.createElement( 'div' );
		filters.className = 'noon-focal-size-previews__filters';
		const search = document.createElement( 'input' );
		search.type = 'search';
		search.placeholder = __( 'Name or dimensions…', 'focal-point-images-smart-crop' );
		const shape = document.createElement( 'select' );
		shapeOptions().forEach( ( option ) => shape.add( new Option( option.label, option.value ) ) );
		[
			[ __( 'Find a size', 'focal-point-images-smart-crop' ), search ],
			[ __( 'Shape', 'focal-point-images-smart-crop' ), shape ],
		].forEach( ( [ text, control ] ) => {
			const label = document.createElement( 'label' );
			const title = document.createElement( 'span' );
			title.textContent = text;
			label.append( title, control );
			filters.appendChild( label );
		} );
		const status = document.createElement( 'div' );
		status.className = 'noon-focal-size-previews__filter-status';
		const count = document.createElement( 'span' );
		count.setAttribute( 'role', 'status' );
		const clear = document.createElement( 'button' );
		clear.type = 'button';
		clear.className = 'button-link';
		clear.textContent = __( 'Clear filters', 'focal-point-images-smart-crop' );
		status.append( count, clear );
		filters.appendChild( status );
		const empty = document.createElement( 'p' );
		empty.className = 'description';
		empty.textContent = __( 'No sizes match. Try another search or clear the filters.', 'focal-point-images-smart-crop' );
		grid.before( filters, empty );
		const filter = () => {
			let visible = 0;
			items.forEach( ( { size, figure } ) => {
				figure.hidden = ! matchesSize( size, search.value, shape.value );
				if ( ! figure.hidden ) visible++;
			} );
			count.textContent = resultsMessage( visible, sizes.length );
			empty.hidden = visible > 0;
			clear.hidden = ! search.value && shape.value === 'all';
		};
		search.addEventListener( 'input', filter );
		shape.addEventListener( 'change', filter );
		clear.addEventListener( 'click', () => {
			search.value = '';
			shape.value = 'all';
			filter();
			search.focus();
		} );
		filter();

		return ( fx, fy, faces = [] ) => {
			items.forEach( ( { size, img, badge } ) => {
				const pos = cropPosition( imgW, imgH, size.w, size.h, fx, fy );
				img.style.objectPosition = `${ pos.x }% ${ pos.y }%`;

				const info = faces.length
					? faceBadge( faceCoverage( faces, imgW, imgH, size, { x: fx, y: fy } ) )
					: null;
				badge.hidden = ! info;
				badge.className = info ? `noon-focal-face-badge noon-focal-face-badge--${ info.state }` : '';
				badge.textContent = info ? info.text : '';
			} );
		};
	}

	/**
	 * Outline detected faces over the picker image (image-focus positions its
	 * marker relative to the img's parent, so that parent hugs the image).
	 */
	function renderFaces( img, faces, onRemove ) {
		const parent = img.parentElement;
		parent.querySelector( '.noon-focal-faces' )?.remove();

		if ( ! faces.length ) {
			return;
		}

		const overlay = document.createElement( 'div' );
		overlay.className = 'noon-focal-faces';
		faces.forEach( ( face, index ) => {
			const box = document.createElement( 'span' );
			box.style.left = `${ face.raw.x * 100 }%`;
			box.style.top = `${ face.raw.y * 100 }%`;
			box.style.width = `${ face.raw.w * 100 }%`;
			box.style.height = `${ face.raw.h * 100 }%`;
			const remove = document.createElement( 'button' );
			remove.type = 'button';
			remove.className = 'noon-focal-faces__remove';
			remove.textContent = '×';
			remove.setAttribute( 'aria-label', __( 'Remove detected face', 'focal-point-images-smart-crop' ) + ` ${ index + 1 }` );
			remove.title = __( 'Remove detected face', 'focal-point-images-smart-crop' );
			[ 'pointerdown', 'mousedown', 'touchstart' ].forEach( ( event ) => {
				remove.addEventListener( event, ( e ) => e.stopPropagation() );
			} );
			remove.addEventListener( 'click', ( event ) => {
				event.stopPropagation();
				onRemove( index );
			} );
			box.appendChild( remove );
			overlay.appendChild( box );
		} );
		parent.appendChild( overlay );
	}

	function closeDialog() {
		dismissPreview?.();
		dismissPreview = null;
		if ( dialog ) {
			dialog.dialog( 'destroy' ).remove();
			dialog = null;
		}
	}

	/**
	 * In the media library's attachment details view the button sits with
	 * core's "Edit Image" under the picture, next to where the editor is
	 * looking, rather than down the sidebar. Other frames (the post editor's
	 * media modal has no actions row) keep it in the field.
	 *
	 * core's actions row re-renders whenever the attachment model changes —
	 * notably once "sizes" data arrives, which on a deep-linked single
	 * attachment (?item=ID) can land after the compat field does — replacing
	 * its contents outright. So the field's button is never moved, only
	 * hidden there and mirrored as a clone in the actions row; if that row
	 * is wiped, syncDetails() (re-run on every change inside the details
	 * pane) just clones a fresh one from the still-present original.
	 */
	function syncDetails( details ) {
		const container = $( details ).find( '.Noon_Focal_Retina_Container' ).first();
		const original = container.find( '.noon_edit_focalpoint' );

		if ( ! original.length ) {
			return;
		}

		const actions = $( details ).find( '.attachment-actions' );

		if ( ! actions.length ) {
			original.removeClass( 'hidden' );
			return;
		}

		original.addClass( 'hidden' );
		if ( ! actions.find( '.noon_edit_focalpoint' ).length ) {
			original.clone( true ).removeClass( 'hidden' ).appendTo( actions );
		}
	}

	function watchFields() {
		const sync = ( root ) => {
			$( root ).find( '.attachment-details' ).addBack( '.attachment-details' ).each( ( _, el ) => syncDetails( el ) );
		};
		sync( document );
		new MutationObserver( ( records ) => {
			records.forEach( ( record ) => {
				const details = $( record.target ).closest( '.attachment-details' );
				if ( details.length ) {
					syncDetails( details[ 0 ] );
					return;
				}
				record.addedNodes.forEach( ( node ) => {
					if ( node.nodeType === 1 ) {
						sync( node );
					}
				} );
			} );
		} ).observe( document.body, { childList: true, subtree: true } );
	}

	function openDialog( button ) {
		closeDialog();

		const id = $( button ).data( 'attachment-id' );
		// The clicked button may be the actions-row clone, not the field's own (syncDetails).
		const container = $( button )
			.closest( '.Noon_Focal_Retina_Container, .attachment-details' )
			.find( '.Noon_Focal_Retina_Container' )
			.addBack( '.Noon_Focal_Retina_Container' )
			.first();
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
				let faces = [];
				const leftControl = dialog.find( '[data-focal-axis="x"]' )[ 0 ];
				const topControl = dialog.find( '[data-focal-axis="y"]' )[ 0 ];
				const updateCoordinates = ( x, y ) => {
					leftControl.value = Math.round( x * 1000 ) / 10;
					topControl.value = Math.round( y * 1000 ) / 10;
				};

				updatePreviews( parseFloat( initial.x ), parseFloat( initial.y ) );
				updateCoordinates( parseFloat( initial.x ), parseFloat( initial.y ) );

				// image-focus uses -1..1 with y pointing up; WordPress meta uses 0..1 from the top-left.
				const picker = new FocusPicker( img, {
					focus: { x: ( initial.x - 0.5 ) * 2, y: ( initial.y - 0.5 ) * -2 },
					debounceTime: 17,
					onChange( focus ) {
						const x = focus.x / 2 + 0.5;
						const y = focus.y / -2 + 0.5;
						inputX.value = x.toFixed( 4 );
						inputY.value = y.toFixed( 4 );
						updateCoordinates( x, y );
						updatePreviews( x, y, faces );
					},
				} );
				[ leftControl, topControl ].forEach( ( control ) => {
					control.addEventListener( 'input', () => {
						if ( ! Number.isFinite( control.valueAsNumber ) ) return;
						const point = { x: parseFloat( inputX.value ), y: parseFloat( inputY.value ) };
						point[ control.dataset.focalAxis ] = Math.min( 100, Math.max( 0, control.valueAsNumber ) ) / 100;
						picker.setFocus( { x: ( point.x - 0.5 ) * 2, y: ( point.y - 0.5 ) * -2 } );
					} );
					control.addEventListener( 'blur', () => updateCoordinates( parseFloat( inputX.value ), parseFloat( inputY.value ) ) );
				} );

				const detect = dialog.find( '.actions .detect-faces' );
				const status = dialog.find( '.actions .faces-status' );
				const removeFace = ( index ) => {
					faces = faces.filter( ( face, i ) => i !== index );
					renderFaces( img, faces, removeFace );
					updatePreviews( parseFloat( inputX.value ), parseFloat( inputY.value ), faces );
					status.text( facesSelectionMessage( faces ) );
				};

				if ( ! faceDetectionAvailable() ) {
					detect.remove();
					status.remove();
				}

				detect.on( 'click', async () => {
					detect.prop( 'disabled', true );
					status.text( __( 'Looking for faces…', 'focal-point-images-smart-crop' ) );
					try {
						faces = await detectFaces( dialog.find( '.Noon_Focal_Retina_Image_Generator_Previews' ).data( 'src' ) || img.currentSrc );
						renderFaces( img, faces, removeFace );

						const imgW = parseInt( container.data( 'width' ), 10 ) || 0;
						const imgH = parseInt( container.data( 'height' ), 10 ) || 0;
						const point = suggestFocus( faces, imgW, imgH, previewSizes() );
						if ( point ) {
							// setFocus() fires onChange, which writes the inputs and previews.
							picker.setFocus( { x: ( point.x - 0.5 ) * 2, y: ( point.y - 0.5 ) * -2 } );
						} else {
							updatePreviews( parseFloat( inputX.value ), parseFloat( inputY.value ), faces );
						}
						status.text( facesMessage( faces ) );
					} catch ( e ) {
						status.text( __( 'Face detection failed.', 'focal-point-images-smart-crop' ) + ( e?.message ? ` ${ e.message }` : '' ) );
					} finally {
						detect.prop( 'disabled', false );
					}
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
		watchFields();
	} );
} )( jQuery );

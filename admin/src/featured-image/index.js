import { useState, useEffect, useRef } from '@wordpress/element';
import { FocalPointPicker } from '@wordpress/components';
import { useSelect, subscribe, select, dispatch } from '@wordpress/data';
import { addFilter } from '@wordpress/hooks';

import './editor.scss';

const DEFAULT_FOCUS = { x: 0.5, y: 0.5 };
const META_KEY = 'noon_focal_point';

const isFocus = ( value ) =>
	value && typeof value.x === 'number' && typeof value.y === 'number';

/**
 * Adds a focal point picker above the featured image panel and saves the
 * chosen point to the attachment's meta when the post is saved.
 */
function withFocalPointPicker( OriginalComponent ) {
	return ( props ) => {
		const { featuredImageId } = props;

		const imageMeta = useSelect(
			( sel ) => ( featuredImageId ? sel( 'core' ).getMedia( featuredImageId ) : null ),
			[ featuredImageId ]
		);

		const savedFocus = isFocus( imageMeta?.meta?.[ META_KEY ] )
			? imageMeta.meta[ META_KEY ]
			: DEFAULT_FOCUS;

		const [ focalPoint, setFocalPoint ] = useState( savedFocus );
		const latest = useRef( { focalPoint: savedFocus, saved: savedFocus, id: featuredImageId } );

		// Reset the picker when the image (or its stored point) changes.
		useEffect( () => {
			setFocalPoint( savedFocus );
			latest.current.saved = savedFocus;
			latest.current.id = featuredImageId;
		}, [ featuredImageId, savedFocus.x, savedFocus.y ] );

		useEffect( () => {
			latest.current.focalPoint = focalPoint;
		}, [ focalPoint ] );

		// Persist the point once per successful (non-auto) post save.
		useEffect( () => {
			let wasSaving = false;

			const unsubscribe = subscribe( () => {
				const editor = select( 'core/editor' );
				const isSaving = editor.isSavingPost() && ! editor.isAutosavingPost();

				if ( isSaving ) {
					wasSaving = true;
					return;
				}

				if ( ! wasSaving ) {
					return;
				}
				wasSaving = false;

				if ( ! editor.didPostSaveRequestSucceed() ) {
					return;
				}

				const { focalPoint: current, saved, id } = latest.current;

				if ( ! id || ( current.x === saved.x && current.y === saved.y ) ) {
					return;
				}

				latest.current.saved = current;

				// Saving through the entity store keeps getMedia() in sync.
				dispatch( 'core' ).saveEntityRecord( 'postType', 'attachment', {
					id,
					meta: { [ META_KEY ]: current },
				} );
			} );

			return unsubscribe;
		}, [] );

		if ( ! imageMeta ) {
			return <OriginalComponent { ...props } />;
		}

		return (
			<div className="remove_standard_image">
				<FocalPointPicker
					label=""
					url={ imageMeta.source_url }
					dimensions={ { width: imageMeta.width, height: imageMeta.height } }
					value={ focalPoint }
					onChange={ setFocalPoint }
				/>
				<OriginalComponent { ...props } />
			</div>
		);
	};
}

addFilter(
	'editor.PostFeaturedImage',
	'noon-focal-retina-image-generator/featured-image-display',
	withFocalPointPicker
);

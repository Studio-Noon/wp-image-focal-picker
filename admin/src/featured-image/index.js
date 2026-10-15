import { useState, useEffect } from "@wordpress/element";
import {
  Button,
  __experimentalHStack as HStack,
  __experimentalText as Text,
} from "@wordpress/components";
import { __, sprintf } from "@wordpress/i18n";
import { addFilter } from "@wordpress/hooks";

import { CENTRE, fetchMedia, onFocalSaved, readFocal } from "../focal/data";
import "./editor.scss";

const percent = (n) => `${Math.round(n * 100)}%`;

/**
 * "Edit focal point" under core's featured image panel, which is left as it
 * is. A featured image has no per-post focal point: the button opens the
 * image's own one in the media modal's "Edit image" screen (Focal Point mode),
 * the same editor as the media library. The media bundle provides it as
 * window.noonFocalOpenEditor; without it there's no button.
 */
function withFocalPointButton(OriginalComponent) {
  return (props) => {
    const { featuredImageId: id } = props;
    const [point, setPoint] = useState(null);

    // Show the current point, and follow saves made in the editor.
    useEffect(() => {
      setPoint(null);

      if (!id) {
        return;
      }

      let live = true;

      fetchMedia(id)
        .then((record) => live && setPoint(readFocal(record).point || CENTRE))
        .catch(() => {});

      const unsubscribe = onFocalSaved((detail) => {
        if (live && detail.media) {
          setPoint(readFocal(detail.media).point || CENTRE);
        }
      }, id);

      return () => {
        live = false;
        unsubscribe();
      };
    }, [id]);

    const openEditor = window.noonFocalOpenEditor;

    if (!id || typeof openEditor !== "function") {
      return <OriginalComponent {...props} />;
    }

    return (
      <>
        <OriginalComponent {...props} />
        <HStack className="noon-focal-featured-image" justify="space-between" wrap>
          <Button
            variant="secondary"
            onClick={() => openEditor(id)}
            __next40pxDefaultSize
          >
            {__("Edit focal point", "focal-point-images-smart-crop")}
          </Button>
          {point && (
            <Text variant="muted">
              {sprintf(
                /* translators: 1: horizontal position, 2: vertical position, e.g. 34% */
                __("X %1$s · Y %2$s", "focal-point-images-smart-crop"),
                percent(point.x),
                percent(point.y)
              )}
            </Text>
          )}
        </HStack>
      </>
    );
  };
}

addFilter(
  "editor.PostFeaturedImage",
  "focal-point-images-smart-crop/featured-image-display",
  withFocalPointButton
);

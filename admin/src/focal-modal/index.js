/**
 * Full-screen focal point editor for the block editor: the image with the
 * picker on the left, every cropped size updating live on the right.
 *
 * Works on a draft of the point. Nothing is saved (or rendered by Glide)
 * until Apply; Cancel throws the draft away.
 */
import {
  Modal,
  Button,
  FocalPointPicker,
  Flex,
  FlexItem,
} from "@wordpress/components";
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import SizePreviews from "../size-previews";
import "./modal.scss";

export default function FocalPointModal({
  src,
  width,
  height,
  value,
  onApply,
  onClose,
}) {
  const [draft, setDraft] = useState(value);

  return (
    <Modal
      title={__("Focal point", "focal-point-images-smart-crop")}
      onRequestClose={onClose}
      isFullScreen
      className="noon-focal-modal"
    >
      <div className="noon-focal-editor">
        <div className="noon-focal-editor__stage">
          <FocalPointPicker
            label=""
            url={src}
            dimensions={{ width, height }}
            value={draft}
            onChange={setDraft}
            onDrag={setDraft}
          />
          <p className="description">
            {__(
              "Drag the point to the most important part of the image. The crops on the right follow it live; nothing is generated or saved until you apply.",
              "focal-point-images-smart-crop",
            )}
          </p>
        </div>
        <div className="noon-focal-editor__previews">
          <SizePreviews
            src={src}
            width={width}
            height={height}
            focus={draft}
            layout="grid"
            showIntro={false}
          />
        </div>
      </div>
      <Flex justify="flex-end" className="noon-focal-modal__actions">
        <FlexItem>
          <Button variant="tertiary" onClick={onClose}>
            {__("Cancel", "focal-point-images-smart-crop")}
          </Button>
        </FlexItem>
        <FlexItem>
          <Button variant="primary" onClick={() => onApply(draft)}>
            {__("Apply", "focal-point-images-smart-crop")}
          </Button>
        </FlexItem>
      </Flex>
    </Modal>
  );
}

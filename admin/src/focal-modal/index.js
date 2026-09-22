/**
 * Full-screen focal point editor for the block editor: the image with the
 * picker on the left, every cropped size updating live on the right.
 *
 * Works on a draft of the point. Nothing is saved (or rendered by Glide)
 * until Apply; Cancel throws the draft away.
 */
import { Modal, Button } from "@wordpress/components";
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import SizePreviews from "../size-previews";
import { FaceSuggest, FocalPicker } from "../faces";
import "./modal.scss";

export default function FocalPointModal({
  src,
  width,
  height,
  value,
  faces: initialFaces = [],
  onApply,
  onClose,
}) {
  const [draft, setDraft] = useState(value);
  const [faces, setFaces] = useState(initialFaces);

  return (
    <Modal
      title={__("Focal point", "focal-point-images-smart-crop")}
      onRequestClose={onClose}
      isFullScreen
      className="noon-focal-modal"
    >
      <div className="noon-focal-modal__layout">
        <div className="noon-focal-editor">
          <div className="noon-focal-editor__stage">
            <FocalPicker
              label=""
              url={src}
              dimensions={{ width, height }}
              value={draft}
              onChange={setDraft}
              onDrag={setDraft}
              faces={faces}
              onFacesChange={setFaces}
            />
            <FaceSuggest
              src={src}
              width={width}
              height={height}
              onFaces={setFaces}
              faces={faces}
              onSuggest={setDraft}
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
              faces={faces}
              layout="grid"
              showIntro={false}
            />
          </div>
        </div>
        <footer className="noon-focal-modal__actions">
          <div className="noon-focal-coordinates">
            {[
              ["x", __("Left (%)", "focal-point-images-smart-crop")],
              ["y", __("Top (%)", "focal-point-images-smart-crop")],
            ].map(([axis, label]) => (
              <label key={axis}>
                <span>{label}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={Math.round(draft[axis] * 1000) / 10}
                  onChange={(event) => {
                    const percent = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(percent)) {
                      setDraft((point) => ({
                        ...point,
                        [axis]: Math.min(100, Math.max(0, percent)) / 100,
                      }));
                    }
                  }}
                />
              </label>
            ))}
          </div>
          <Button variant="tertiary" onClick={onClose}>
            {__("Cancel", "focal-point-images-smart-crop")}
          </Button>
          <Button variant="primary" onClick={() => onApply(draft, faces)}>
            {__("Apply", "focal-point-images-smart-crop")}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

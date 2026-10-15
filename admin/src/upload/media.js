/**
 * Admin (media library, attachment edit, and every screen with a media
 * modal): focal point field in the attachment details, Focal Point mode in
 * the image editor, and automatic face detection after uploads.
 */
import { watchUploads } from "../focal/auto";
import { watchMediaViews } from "../focal/media-views";
import "./style.scss";

watchUploads();
watchMediaViews();

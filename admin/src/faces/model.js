/** Model and detector are bundled together, fetched only on first use. */
import * as faceapi from '@vladmandic/face-api';
import model from '@vladmandic/face-api/model/tiny_face_detector_model.bin';
import manifest from '@vladmandic/face-api/model/tiny_face_detector_model-weights_manifest.json';

export async function loadDetector() {
	await faceapi.tf.ready();
	const binary = atob( model.slice( model.indexOf( ',' ) + 1 ) );
	const bytes = Uint8Array.from( binary, ( character ) => character.charCodeAt( 0 ) );
	const weights = faceapi.tf.io.decodeWeights( bytes.buffer, manifest[ 0 ].weights );
	try {
		faceapi.nets.tinyFaceDetector.loadFromWeightMap( weights );
	} catch ( error ) {
		faceapi.tf.dispose( weights );
		throw error;
	}
	return faceapi;
}

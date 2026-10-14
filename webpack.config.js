/**
 * wp-scripts' config, with one change: the face detector that detect.js
 * loads with import() stays in the single chunk it names (admin/build/face-api.js)
 * instead of being split into a numbered vendor chunk.
 */
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );

module.exports = {
	...defaultConfig,
	module: {
		...defaultConfig.module,
		rules: [
			...defaultConfig.module.rules,
			{ test: /tiny_face_detector_model\.bin$/, type: 'asset/inline' },
		],
	},
	optimization: {
		...defaultConfig.optimization,
		splitChunks: {
			...defaultConfig.optimization.splitChunks,
			cacheGroups: {
				...defaultConfig.optimization.splitChunks.cacheGroups,
				defaultVendors: false,
			},
		},
	},
};

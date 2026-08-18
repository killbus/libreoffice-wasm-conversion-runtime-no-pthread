import { buildJsBundles } from './build-js-bundles.mjs';
import { verifyNativePackageAssets } from './verify-native-package-assets.mjs';

const silent = process.argv.includes('--silent');

await verifyNativePackageAssets({ root: process.cwd() });
buildJsBundles({ silent });

import { CLOUD } from './src/config';
import { CloudApp } from './src/CloudApp';
import LegacyApp from './src/LegacyApp';

export default CLOUD ? CloudApp : LegacyApp;

import 'dotenv/config';
import { config } from './config.js';
import { createApp } from './create-app.js';

createApp().listen(config.PORT, () => {
  console.log(`exercices listening on http://localhost:${config.PORT}`);
});

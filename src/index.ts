import { createApp } from './app';
import { config } from './config';

const app = createApp();

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`VRM Check listening on http://localhost:${config.port}`);
  });
}

export default app;

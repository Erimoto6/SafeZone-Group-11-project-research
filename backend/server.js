require('dotenv').config({ quiet: true });
const app = require('./src/app');
const port = Number(process.env.PORT) || 3000;

app.listen(port, '0.0.0.0', () => {
  console.log(`SafeZone API is running: http://localhost:${port}/api/health`);
});

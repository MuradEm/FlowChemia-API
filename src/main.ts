import 'dotenv/config';
import { createApp } from './app.js';
import { SurveyScheduler } from './scheduler.js';

const port=Number(process.env.PORT??3001);
if (!Number.isInteger(port) || port<1 || port>65535) throw new Error('Invalid PORT');
const app=await createApp();
await app.listen(port,'127.0.0.1');

app.get(SurveyScheduler).start();

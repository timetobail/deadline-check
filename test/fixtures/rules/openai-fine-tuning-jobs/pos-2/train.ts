import OpenAI from 'openai';
const job = await client.fineTuning.jobs.create({ training_file: f, model });

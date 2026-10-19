from openai import OpenAI
job = client.fine_tuning.jobs.create(training_file=f, model=base)

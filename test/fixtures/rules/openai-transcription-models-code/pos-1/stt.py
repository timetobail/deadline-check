from openai import OpenAI
t = client.audio.transcriptions.create(model="whisper-1", file=f)

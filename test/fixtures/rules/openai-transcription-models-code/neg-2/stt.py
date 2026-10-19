from openai import OpenAI
client = OpenAI(base_url="https://api.groq.com/openai/v1")
t = client.audio.transcriptions.create(model="whisper-1", file=f)

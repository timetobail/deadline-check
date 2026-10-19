from openai import AzureOpenAI
audio = client.audio.speech.create(model="tts-1", input=t)

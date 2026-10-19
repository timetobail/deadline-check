from openai import OpenAI
audio = client.audio.speech.create(model="tts-1-hd", voice="alloy", input=t)

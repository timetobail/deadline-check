from openai import OpenAI

client = OpenAI()


def summarize(text: str) -> str:
    resp = client.chat.completions.create(model="gpt-4", messages=[{"role": "user", "content": text}])
    return resp.choices[0].message.content

br = boto3.client("bedrock-runtime")
r = br.converse(modelId="us.meta.llama3-3-70b-instruct-v1:0", messages=m)

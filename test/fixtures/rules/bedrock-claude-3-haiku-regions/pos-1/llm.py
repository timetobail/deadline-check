br = boto3.client("bedrock-runtime", region_name="ap-south-1")
r = br.converse(modelId="anthropic.claude-3-haiku-20240307-v1:0", messages=m)

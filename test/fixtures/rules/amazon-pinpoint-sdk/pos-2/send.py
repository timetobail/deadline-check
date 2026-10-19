pp = boto3.client("pinpoint")
pp.create_segment(ApplicationId=a, WriteSegmentRequest=w)

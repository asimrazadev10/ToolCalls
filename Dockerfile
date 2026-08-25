# Marginalia and Isobar on AWS Lambda.
#
# Lambda Web Adapter rather than a handler rewrite: it puts a small extension
# in front of an ordinary HTTP server, so `next start` runs unmodified and the
# same image runs locally with `docker run -p 3000:8080`. Nothing about the
# application knows it is on Lambda.
#
# The routes here run well past API Gateway's 29-second integration timeout —
# parsing a 40-page PDF measured 9s, answering 10-20s, and Isobar's own budget
# is 50s — so this is invoked through a Lambda Function URL, which allows up to
# 15 minutes and supports response streaming. Isobar streams its answers, so
# that is a requirement rather than a nicety.

FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 AS adapter

FROM node:22-slim AS runner
COPY --from=adapter /lambda-adapter /opt/extensions/lambda-adapter

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AWS_LWA_INVOKE_MODE=response_stream \
    AWS_LWA_READINESS_CHECK_PATH=/api/health

WORKDIR /app

# Standalone output carries its own minimal server and traced dependencies.
# Static assets and the public directory are not traced and must come along
# separately, or every page renders unstyled.
COPY .next/standalone ./
COPY .next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]

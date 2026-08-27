#!/usr/bin/env bash
#
# Builds the image, deploys the stack, then revokes the access key it used.
#
# The account holds no long-lived credential between deploys. You create an
# access key when you want to ship, this spends it, and it deletes the key on
# the way out -- so a forgotten key cannot sit on disk for months waiting to
# leak. That is the whole reason this is a script and not a list of commands in
# a README: revocation is the step a human skips.
#
# Before running:
#   1. IAM -> Users -> deploy-cli -> Security credentials -> Create access key
#   2. aws configure         (key, secret, region us-east-1)
#   3. ./scripts/deploy.sh
#
# Set KEEP_KEY=1 to leave the key in place -- useful when a deploy fails and you
# want to retry without minting a new one. Revoke it yourself afterwards.

set -euo pipefail

REGION=us-east-1
ACCOUNT=437521954794
STACK=marginalia
REPOSITORY=marginalia
IMAGE_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPOSITORY}"

cd "$(dirname "$0")/.."

say() { printf '\n=== %s ===\n' "$1"; }

# --- revocation ---------------------------------------------------------------
# Registered before anything else so it runs whatever happens: a failed build, a
# rolled-back stack, or Ctrl-C all still end with the key gone.
KEY_ID=""
revoke() {
  local status=$?

  if [ -n "${KEEP_KEY:-}" ]; then
    printf '\nKEEP_KEY set -- access key %s left active. Revoke it when done:\n' "${KEY_ID:-<none>}"
    printf '  aws iam delete-access-key --user-name deploy-cli --access-key-id %s\n' "${KEY_ID:-<id>}"
    return $status
  fi

  if [ -n "$KEY_ID" ]; then
    say 'revoking the access key'
    # Deleting the credential this shell is authenticated with, so it must be
    # the last call that needs AWS.
    if aws iam delete-access-key --user-name deploy-cli --access-key-id "$KEY_ID" 2>/dev/null; then
      echo "  deleted $KEY_ID"
    else
      echo "  could not delete $KEY_ID -- do it in the IAM console"
    fi
    rm -f ~/.aws/credentials && echo '  removed ~/.aws/credentials'
    echo '  ~/.aws/config kept, so the next deploy only needs new keys'
  else
    # Credentials came from somewhere this script cannot revoke -- environment
    # variables, an SSO session, an assumed role. Say so rather than exit
    # quietly, which would read as "the key was cleaned up" when it was not.
    printf '\nNo access key found in ~/.aws/credentials, so nothing was revoked.\n'
    printf 'If you exported credentials into the environment, unset them yourself.\n'
  fi

  return $status
}
trap revoke EXIT

# --- preflight ----------------------------------------------------------------
say 'checking credentials'
if ! CALLER=$(aws sts get-caller-identity --output json 2>&1); then
  echo "$CALLER"
  echo
  echo 'No credentials. Create an access key for deploy-cli in the IAM console,'
  echo 'run `aws configure`, then run this again.'
  exit 1
fi
echo "  $(echo "$CALLER" | python3 -c 'import json,sys;print(json.load(sys.stdin)["Arn"])')"

# Captured so the trap can revoke exactly the key in use, rather than every key
# on the user -- which would clobber a key someone else is holding.
KEY_ID=$(aws configure get aws_access_key_id)

[ -f .env ] || { echo 'no .env -- it holds the Gemini and Supabase values'; exit 1; }
set -a; . ./.env; set +a
: "${GOOGLE_GENERATIVE_AI_API_KEY:?missing from .env}"
: "${SUPABASE_URL:?missing from .env}"
: "${SUPABASE_PUBLISHABLE_KEY:?missing from .env}"

say 'verifying before shipping'
npm run verify

# --- image --------------------------------------------------------------------
# Tagged by commit so a deploy names exactly what it shipped, and a rollback is
# a matter of pointing the stack at an earlier tag.
TAG=$(git rev-parse --short HEAD)
[ -z "$(git status --porcelain)" ] || TAG="${TAG}-dirty"

say "building ${REPOSITORY}:${TAG}"
aws ecr describe-repositories --repository-names "$REPOSITORY" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$REPOSITORY" --region "$REGION" >/dev/null

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

# linux/amd64 explicitly: Lambda rejects an arm64 image against an x86_64
# function, and a build on an Apple Silicon machine would otherwise produce one.
docker build --platform linux/amd64 -t "${IMAGE_URI}:${TAG}" .
docker push "${IMAGE_URI}:${TAG}"

# --- stack --------------------------------------------------------------------
say 'deploying the stack'
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file infra/marginalia-stack.yaml \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --region "$REGION" \
  --parameter-overrides \
    "ImageUri=${IMAGE_URI}:${TAG}" \
    "GeminiApiKey=${GOOGLE_GENERATIVE_AI_API_KEY}" \
    "SupabaseUrl=${SUPABASE_URL}" \
    "SupabasePublishableKey=${SUPABASE_PUBLISHABLE_KEY}"

# A new image with an unchanged tag leaves the function pointing at the old
# digest, because the template parameter did not change. Force the pull.
aws lambda update-function-code \
  --function-name "$STACK" \
  --image-uri "${IMAGE_URI}:${TAG}" \
  --region "$REGION" >/dev/null
aws lambda wait function-updated --function-name "$STACK" --region "$REGION"

# --- smoke --------------------------------------------------------------------
say 'smoke test'
URL=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='IsobarUrl'].OutputValue" --output text)
URL="${URL%/}"

for path in /api/health / /marginalia; do
  printf '  %-14s %s\n' "$path" \
    "$(curl -s -o /dev/null -w '%{http_code} in %{time_total}s' --max-time 90 "${URL}${path}")"
done

# Unauthenticated asks must be refused. A 200 here would mean the per-user
# boundary was lost, which is worth failing a deploy over.
ASK=$(curl -s -o /dev/null -w '%{http_code}' --max-time 90 \
  -X POST "${URL}/api/rag/ask" -H 'content-type: application/json' -d '{"question":"x"}')
printf '  %-14s %s\n' 'ask (no auth)' "$ASK"
[ "$ASK" = '401' ] || { echo "  expected 401, got $ASK"; exit 1; }

say 'deployed'
echo "  Isobar      ${URL}/"
echo "  Marginalia  ${URL}/marginalia"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ECR_REGISTRY="822612423419.dkr.ecr.us-west-2.amazonaws.com"
ECR_IMAGE="${ECR_REGISTRY}/friendly-words:latest"
AWS_REGION="${AWS_REGION:-us-west-2}"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login -u AWS --password-stdin "$ECR_REGISTRY"

docker buildx build \
  --platform linux/arm64 \
  --build-context cruzi-models=../cruzi-models \
  --build-context cruzi-db=../cruzi-db \
  -t "$ECR_IMAGE" \
  --push \
  .

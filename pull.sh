#!/usr/bin/env bash
set -euo pipefail

ECR_REGISTRY="822612423419.dkr.ecr.us-west-2.amazonaws.com"
ECR_IMAGE="${ECR_REGISTRY}/friendly-words:latest"
AWS_REGION="${AWS_REGION:-us-west-2}"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login -u AWS --password-stdin "$ECR_REGISTRY"

docker pull "$ECR_IMAGE"
docker tag "$ECR_IMAGE" friendly-words:latest

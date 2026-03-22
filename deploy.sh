#!/bin/bash

APP_DIR=~/catlobby
BRANCH=new_feature_postgres_three

echo "Deploying latest code..."

cd $APP_DIR

cp .env /tmp/env_backup

git fetch origin
git reset --hard origin/$BRANCH

mv /tmp/env_backup .env

npm install

pm2 restart all

echo "Deployment complete"

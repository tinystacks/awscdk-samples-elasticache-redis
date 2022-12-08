#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ElasticacheRedisStack } from './elasticacheRedisStack';

const app = new cdk.App();

if (!process.env.STACK_NAME) {
  throw new Error("env var STACK_NAME must be defined");
}

new ElasticacheRedisStack(app, process.env.STACK_NAME as string, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEAULT_REGION
  }
}, process.env.VPC_ID);

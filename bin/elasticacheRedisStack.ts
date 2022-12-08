import { constructId } from '@tinystacks/iac-utils';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cdk from 'aws-cdk-lib';
import {
  VPC,
  SecurityGroups,
  Redis
} from '@tinystacks/aws-cdk-constructs';

export class ElasticacheRedisStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, stackProps?: cdk.StackProps, importedVpcId?: string) {
        super(scope, id, stackProps);
        let vpc: ec2.IVpc;


        if (!importedVpcId) {
          // Create VPC
          const vpcConstruct = new VPC(this, constructId(id + '-ec-redis-vpc'), {
            internetAccess: false,
          });
          vpc = vpcConstruct.vpc;
        } else {
          vpc = ec2.Vpc.fromLookup(this, constructId(id + '-ec-redis-vpc'), {
            vpcId: importedVpcId
          });
        }
        
        
        // Create Security Group
        const sgRules = [
          { name: 'Postgres', port: ec2.Port.tcp(6379), peer: ec2.Peer.anyIpv4() },
        ]

        const commonSecurityGroup = new SecurityGroups(this, constructId(id + '-ec-redis-vpc-sgs'), {
          vpc,
          securityGroupName: 'common',
          securityGroupRulesList: sgRules
        });

        // Create RDS Postgres

        new Redis(this, constructId(id + 'ec-redis'), {
          dbIdentifier: id + '-ec-redis',
          vpc,
          securityGroupsList: [commonSecurityGroup.securityGroup],
          instanceType: 'cache.t3.micro',
          subnets: vpc.isolatedSubnets
        });
    }
}
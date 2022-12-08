/* eslint-env node */
const AWS = require('aws-sdk');
const response = require('cfn-response');

async function getEnis (ec2Client, nextToken) {
  let params;
  if (nextToken && nextToken !== 'next') {
    params = { NextToken: nextToken };
  }
  const { NetworkInterfaces = [], NextToken } = await ec2Client.describeNetworkInterfaces(params).promise();

  return { enis: NetworkInterfaces, nextToken: NextToken };
}

async function getSecurityGroups (ec2Client, nextToken, props) {
  const params = {
    Filters: [
      {
        Name: 'vpc-id',
        Values: [props.vpcId]
      }
    ]
  };
  if (nextToken && nextToken !== 'next') {
    params.NextToken = nextToken;
  }
  const { SecurityGroups: securityGroups = [], NextToken } = await ec2Client.describeSecurityGroups(params).promise();

  return { securityGroups, nextToken: NextToken };
}

async function getDriftedEnis (ec2Client, props) {
  const {
    vpcId,
    clusterName
  } = props;
  const driftedEnis = [];
  const driftedEniPattern = `eks-cluster-sg-${clusterName}`;
  let pageToken = 'next';
  while (pageToken) {
    const { enis = [], nextToken } = await getEnis(ec2Client, pageToken);
    driftedEnis.push(
      ...enis.filter(({ VpcId, Groups = [] }) => {
        return VpcId === vpcId && Groups.some(sg => sg.GroupName.startsWith(driftedEniPattern));
      })
    );
    pageToken = nextToken;
  }
  return driftedEnis;
}

async function getDriftedSecurityGroups (ec2Client, props) {
  const {
    vpcId,
    clusterName
  } = props;
  const driftedSecurityGroups = [];
  const driftedSgPattern = `eks-cluster-sg-${clusterName}`;
  let pageToken = 'next';
  while (pageToken) {
    const { securityGroups = [], nextToken } = await getSecurityGroups(ec2Client, pageToken, props);
    driftedSecurityGroups.push(
      ...securityGroups.filter(({ VpcId, GroupName }) => {
        return VpcId === vpcId && GroupName.startsWith(driftedSgPattern);
      }
      )
    );
    pageToken = nextToken;
  }
  return driftedSecurityGroups;
}

async function deleteDriftedEnis (ec2Client, props) {
  const driftedEnis = await getDriftedEnis(ec2Client, props);
  console.info('Plan is to delete the following enis: ', JSON.stringify(driftedEnis));
  for (const eni of driftedEnis) {
    const { NetworkInterfaceId } = eni;
    await ec2Client.deleteNetworkInterface({ NetworkInterfaceId })
      .promise()
      .catch((error) => {
        console.error(`Failed to delete ENI: ${NetworkInterfaceId}`);
        console.error(error);
      });
  }
}

async function deleteDriftedSecurityGroups (ec2Client, props) {
  const driftedSecurityGroups = await getDriftedSecurityGroups(ec2Client, props);
  console.info('Plan is to delete the following security groups: ', JSON.stringify(driftedSecurityGroups));
  for (const sg of driftedSecurityGroups) {
    const { GroupId } = sg;
    await ec2Client.deleteSecurityGroup({ GroupId })
      .promise()
      .catch((error) => {
        console.error(`Failed to delete security group: ${GroupId}`);
        console.error(error);
      });
  }
}

async function handler (event, context) {
  const { ResourceProperties: props } = event;
  try {
    const ec2Client = new AWS.EC2();
    if (event.RequestType === 'Delete') {
      await deleteDriftedEnis(ec2Client, props);
      await deleteDriftedSecurityGroups(ec2Client, props);
      response.send(event, context, response.SUCCESS);
      return;
    }
    response.send(event, context, response.SUCCESS);
    return;
  } catch (error) {
    console.error(error);
    response.send(event, context, response.FAILED);
    throw new Error('Failed to delete Lambda ENIs!');
  }
}

module.exports = {
  handler
};
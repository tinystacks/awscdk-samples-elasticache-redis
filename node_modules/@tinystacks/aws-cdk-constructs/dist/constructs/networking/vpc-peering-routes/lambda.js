/* eslint-env node */
const AWS = require('aws-sdk');
const response = require('cfn-response');

async function getVpcRouteTables (vpcId, region) {
  const ec2Client = new AWS.EC2({
    region
  });

  const routeTables = [];
  let nextToken = 'next';

  while (nextToken) {
    const routeTablesResponse = await ec2Client.describeRouteTables({
      Filters: [{
        Name: 'vpc-id',
        Values: [vpcId]
      }]
    }).promise();

    const {
      RouteTables,
      NextToken
    } = routeTablesResponse || {};
    routeTables.push(...RouteTables);
    nextToken = NextToken;
  }

  const publicRouteTables = routeTables.filter(routeTable =>
    !routeTable.Associations.some(association => association.Main === true) &&
    routeTable.Routes.some(route => route.GatewayId?.startsWith('igw'))
  );
  const privateRouteTables = routeTables.filter(routeTable =>
    !routeTable.Associations.some(association => association.Main === true) &&
    routeTable.Routes.some(route =>
      route.DestinationCidrBlock === '0.0.0.0/0' &&
      (
        (
          Object.keys(route).includes('InstanceId') &&
          Object.keys(route).includes('InstanceOwnerId') &&
          Object.keys(route).includes('NetworkInterfaceId')
        ) ||
        (
          Object.keys(route).includes('NatGatewayId')
        )
      )
    )
  );

  const publicRouteTableIds = publicRouteTables.map(routeTable => routeTable.RouteTableId);
  const privateRouteTableIds = privateRouteTables.map(routeTable => routeTable.RouteTableId);
  const isolatedRouteTables = routeTables.filter(routeTable =>
    !routeTable.Associations.some(association => association.Main === true) &&
    !publicRouteTableIds.includes(routeTable.RouteTableId) &&
    !privateRouteTableIds.includes(routeTable.RouteTableId)
  );

  return {
    publicRouteTables,
    privateRouteTables,
    isolatedRouteTables
  };
}

async function upsertRoute (routeTable, destinationCidrBlock, peeringConnectionId, region) {
  const ec2Client = new AWS.EC2({
    region
  });

  const existingRoute = routeTable.Routes.find(route =>
    route.DestinationCidrBlock === destinationCidrBlock
  );

  if (!existingRoute) {
    console.info(`Did not find an existing route on route table ${routeTable.RouteTableId} for ${peeringConnectionId} to ${destinationCidrBlock}`);
    console.info('existingRoute: ', JSON.stringify(existingRoute));
    console.info('creating route...');
    await ec2Client.createRoute({
      RouteTableId: routeTable.RouteTableId,
      DestinationCidrBlock: destinationCidrBlock,
      VpcPeeringConnectionId: peeringConnectionId
    }).promise();
  } else if (existingRoute && existingRoute.VpcPeeringConnectionId !== peeringConnectionId) {
    console.info(`Found an existing route on route table ${routeTable.RouteTableId} to ${destinationCidrBlock}, but with different peering connection ${peeringConnectionId}.`);
    console.info('This indicates a failed cleanup occurred previously.');
    console.info('Deleting old route and recreating...');
    await ec2Client.deleteRoute({
      RouteTableId: routeTable.RouteTableId,
      DestinationCidrBlock: destinationCidrBlock
    }).promise();
    await ec2Client.createRoute({
      RouteTableId: routeTable.RouteTableId,
      DestinationCidrBlock: destinationCidrBlock,
      VpcPeeringConnectionId: peeringConnectionId
    }).promise();
  } else {
    console.info(`Route to ${destinationCidrBlock} for peering connection ${peeringConnectionId} already exists on route table ${routeTable.RouteTableId}!`);
    console.info('Skipping route creation...');
  }
}

async function upsertPeeringRoutes (vpcId, peeringConnectionId, destinationCidrBlock, region) {
  const {
    publicRouteTables,
    privateRouteTables,
    isolatedRouteTables
  } = await getVpcRouteTables(vpcId, region);

  for (const publicRouteTable of publicRouteTables) {
    await upsertRoute(publicRouteTable, destinationCidrBlock, peeringConnectionId, region);
  }

  for (const privateRouteTable of privateRouteTables) {
    await upsertRoute(privateRouteTable, destinationCidrBlock, peeringConnectionId, region);
  }

  for (const isolatedRouteTable of isolatedRouteTables) {
    await upsertRoute(isolatedRouteTable, destinationCidrBlock, peeringConnectionId, region);
  }
}

async function deleteRoute (routeTable, destinationCidrBlock, peeringConnectionId, region) {
  const ec2Client = new AWS.EC2({
    region
  });

  const existingRoute = routeTable.Routes.find(route =>
    route.DestinationCidrBlock === destinationCidrBlock
  );

  if (existingRoute) {
    await ec2Client.deleteRoute({
      RouteTableId: routeTable.RouteTableId,
      DestinationCidrBlock: destinationCidrBlock
    }).promise().catch((error) => {
      if (error.code === 'InvalidRoute.NotFound') {
        console.info(`Route found but not found for cidr block ${destinationCidrBlock} on route table ${routeTable.RouteTableId}`);
        console.info('existingRoute: ', JSON.stringify(existingRoute));
        return;
      }
      throw error;
    });
  }
}

async function deletePeeringRoutes (vpcId, peeringConnectionId, destinationCidrBlock, region) {
  const {
    publicRouteTables,
    privateRouteTables,
    isolatedRouteTables
  } = await getVpcRouteTables(vpcId, region);

  for (const publicRouteTable of publicRouteTables) {
    await deleteRoute(publicRouteTable, destinationCidrBlock, peeringConnectionId, region);
  }

  for (const privateRouteTable of privateRouteTables) {
    await deleteRoute(privateRouteTable, destinationCidrBlock, peeringConnectionId, region);
  }

  for (const isolatedRouteTable of isolatedRouteTables) {
    await deleteRoute(isolatedRouteTable, destinationCidrBlock, peeringConnectionId, region);
  }
}

async function responseSuccess (event, context) {
  response.send(event, context, response.SUCCESS);
}

async function handler (event, context) {
  const { ResourceProperties = {}, RequestType } = event;
  const {
    vpcId,
    peeringConnectionId,
    destinationCidrBlock,
    region
  } = ResourceProperties;
  try {
    if (RequestType === 'Delete') {
      console.log(`Deleting peering routes between vpc ${vpcId} and ${destinationCidrBlock} for peering conneciton ${peeringConnectionId}.`);
      await deletePeeringRoutes(vpcId, peeringConnectionId, destinationCidrBlock, region);
      await responseSuccess(event, context);
      return;
    }
    console.log(`${RequestType.substring(0, RequestType.length - 1)}ing peering routes between vpc ${vpcId} and ${destinationCidrBlock} for peering conneciton ${peeringConnectionId}.`);
    await upsertPeeringRoutes(vpcId, peeringConnectionId, destinationCidrBlock, region);
    await responseSuccess(event, context);
    return;
  } catch (error) {
    console.error(error);
    response.send(event, context, response.FAILED);
    throw new Error(`Failed to ${RequestType.toLowerCase()} vpc peering routes!`);
  }
}

module.exports = {
  handler
};
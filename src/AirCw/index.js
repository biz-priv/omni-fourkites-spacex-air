const AWS = require("aws-sdk");
const { getXMLfromS3 } = require("../shared/s3/index");
const { xmlToJson, containsUniversalShipment, isTransportModeAir,
  getReferenceNo, callEAdapterAPI, jsonToPayload, sendPayload, putItem
} = require("../shared/helper.js")
const momentTZ = require("moment-timezone");
const sns = new AWS.SNS({ apiVersion: '2010-03-31' });



module.exports.handler = async (event) => {
  try {
    console.info("Event: \n", JSON.stringify(event));
    let objectKey = decodeURIComponent(
      event.Records[0].s3.object.key.replace(/\+/g, " ")
    );
    console.info("Object Key : ", objectKey);

    // Step 1: Geting XML file from S3 bucket
    const xmlObject = await getXMLfromS3(objectKey);

    // Step 2: Converting XML to JSON
    const jsonObject = await xmlToJson(xmlObject);

    // Step 3: Checking if XML contains Universal shipment and transport mode is AIR
    if (containsUniversalShipment(jsonObject) && isTransportModeAir(jsonObject)) {
      const transportMode = isTransportModeAir(jsonObject);
      console.log("Transport Mode is AIR", transportMode);
    } else {
      // Step 4: Call eAdapter API to fetch transport mode
      const transportMode = await callEAdapterAPI(jsonObject);
      if (transportMode !== "AIR") {
        return {
          statusCode: 200,
          body: "Transport mode is not AIR. Exiting.",
        };
      }
    }

    // Step 5: Converting JSON to payload
    const payload = await jsonToPayload(jsonObject);
    console.log("payload:", JSON.stringify(payload));
    const insertedTimeStamp = momentTZ
      .tz("America/Chicago")
      .format("YYYY:MM:DD HH:mm:ss")
      .toString();

    // Step 6: Sending payload to external api
    const { errorMsg, responseStatus } = await sendPayload(payload);

    const logItem = {
      ShipmentId: payload.reference,
      Payload: JSON.stringify(payload),
      ApiStatusCode: responseStatus,
      ErrorMsg: errorMsg,
      InsertedTimeStamp: insertedTimeStamp,
    };
    console.log("logItem:", logItem);

    // Step 7: Log the data in DynamoDB
    await putItem(process.env.SPACEX_AIR_LOGS_TABLE, logItem);

  } catch (error) {
    // Send a notification to the SNS topic
    const params = {
      Message: `An error occurred in function ${process.env.FUNCTION_NAME}. Error details: ${error}.`,
      Subject: `Lambda function ${process.env.FUNCTION_NAME} has failed.`,
      TopicArn: process.env.ERROR_SNS_ARN,
    };

    try {
      await sns.publish(params).promise();
    } catch (snsError) {
      console.error("Error publishing to SNS:", snsError);
    }
    console.error(error);
  }
};


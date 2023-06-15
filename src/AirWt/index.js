const { getXMLfromS3 } = require("../shared/s3/index");
const { xmlToJson, containsUniversalShipment, isTransportModeAir,
  getReferenceNo, callEAdapterAPI, jsonToPayload, sendPayload
} = require("../shared/helper.js")

let objectKey;

module.exports.handler = async (event) => {
  try {
    console.info("Event: \n", JSON.stringify(event));
    objectKey = decodeURIComponent(
      event.Records[0].s3.object.key.replace(/\+/g, " ")
    );
    console.info("Object Key : ", objectKey);

    /**
     * get xml file from S3 bucket
     */

    const xmlObject = await getXMLfromS3(objectKey);

    const jsonObject = await xmlToJson(xmlObject);
    console.log("jsonObject:", jsonObject);
    // Step 3: Check if XML contains Universal shipment and transport mode is AIR
    let referenceNo;
    if (containsUniversalShipment(jsonObject) && isTransportModeAir(jsonObject)) {
      referenceNo = getReferenceNo(jsonObject);
      console.log("referenceNo:", referenceNo);
    } else {
      // Call eAdapter API to fetch transport mode
      const transportMode = await callEAdapterAPI(jsonObject);
      if (transportMode !== 'AIR') {
        return {
          statusCode: 200,
          body: 'Transport mode is not AIR. Exiting.',
        };
      }
      referenceNo = getReferenceNo(jsonObject);
    }
    const payload = await jsonToPayload(jsonObject)
    console.log("payload:", JSON.stringify(payload));
    // const result = await sendPayload(payload)
  } catch (error) {
    return error;
  }
};


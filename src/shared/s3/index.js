const AWS = require("aws-sdk");
const s3 = new AWS.S3();

/**
 * Fetch Object Data Using Key Of Object from the BUCKET
 * @param {*} keyName
 * @returns
 */
async function getXMLfromS3(keyName) {
  const params = {
    Bucket: process.env.BUCKET,
    Key: keyName,
  };
  try {
    const data = await s3.getObject(params).promise();
    const contents = data.Body.toString();
    console.info("S3 XML Contents : ", contents);
    return contents;
  } catch (err) {
    console.error("ERROR----- ", err);
    throw err;
  }
}

module.exports = { getXMLfromS3 };

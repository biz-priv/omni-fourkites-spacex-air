const AWS = require("aws-sdk");
const convert = require("xml-js");
const axios = require("axios");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const { get } = require('lodash');

async function xmlToJson(xml) {
    try {
        xml = xml.toString("utf-8");
        xml = xml.replace("&", "*AND*");

        let json_data = convert.xml2json(xml, { compact: true, spaces: 4 });
        json_data = JSON.parse(json_data);
        return json_data;
    } catch (error) {
        console.error("Error in xmlToJson:", error.message);
        throw error;
    }
}

function containsUniversalShipment(jsonObject) {
    try {
        if (!jsonObject || !get(jsonObject, 'UniversalInterchange.Body.UniversalShipment')) {
            throw new Error("Invalid JSON object");
        }
        console.info("jsonObject is not null", get(jsonObject, 'UniversalInterchange.Body.UniversalShipment') !== null);
        return get(jsonObject, 'UniversalInterchange.Body.UniversalShipment') !== null;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function isTransportModeAir(jsonObject) {
    try {
        if (!jsonObject || !get(jsonObject, 'UniversalInterchange.Body.UniversalShipment.Shipment')) {
            throw new Error("Invalid JSON object or missing shipment data");
        }
        return get(jsonObject, 'UniversalInterchange.Body.UniversalShipment.Shipment.TransportMode.Code._text') === 'AIR';
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function getReferenceNo(jsonObject) {
    try {
        const shipment = get(jsonObject, 'UniversalInterchange.Body.UniversalShipment.Shipment');
        let reference = null;
        if (get(shipment, 'SubShipmentCollection.SubShipment')) {
            if (Array.isArray(get(shipment, 'SubShipmentCollection.SubShipment'))) {
                reference = get(shipment, 'SubShipmentCollection.SubShipment[0].DataContext.DataSourceCollection.DataSource.Key._text', null);
            } else {
                const dataSources = Array.isArray(get(shipment, 'SubShipmentCollection.SubShipment.DataContext.DataSourceCollection.DataSource')) ? get(shipment, 'SubShipmentCollection.SubShipment.DataContext.DataSourceCollection.DataSource') : [get(shipment, 'SubShipmentCollection.SubShipment.DataContext.DataSourceCollection.DataSource', null)];
                reference = get(dataSources, '[0].Key._text', null);
            }
        }
        return reference;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function generateXmlBody(jsonObject) {
    try {
        const referenceNo = getReferenceNo(jsonObject);
        const xmlBody = `
        <UniversalShipmentRequest xmlns="http://www.cargowise.com/Schemas/Universal/2011/11" version="1.1">
          <ShipmentRequest>
            <DataContext>
              <DataTargetCollection>
                <DataTarget>
                  <Type>ForwardingShipment</Type>
                  <Key>${referenceNo}</Key> 
                </DataTarget>
              </DataTargetCollection>
            </DataContext>
          </ShipmentRequest>
        </UniversalShipmentRequest>
      `;
        return xmlBody;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

async function callEAdapterAPI(jsonObject) {
    try {
        const endpoint = process.env.EADAPTER_URL;
        const xmlBody = generateXmlBody(jsonObject);

        const username = process.env.EADAPTER_USERNAME;
        const password = process.env.EADAPTER_PASSWORD;
        const auth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

        const response = await axios.post(endpoint, xmlBody, {
            headers: {
                'Content-Type': 'application/xml',
                Authorization: `Basic ${auth}`,
            },
        });

        if (response.status !== 200) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        const jsonResponse = await xmlToJson(response.data);
        console.info("jsonResponse:", jsonResponse);

        const transportMode = getTransportMode(jsonResponse);
        console.info("transportMode:", transportMode);

        return transportMode;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function getTransportMode(jsonResponse) {
    try {
        return get(jsonResponse, 'UniversalResponse.Data.UniversalShipment.Shipment.TransportMode.Code._text');
    } catch (error) {
        console.error(error);
        throw error;
    }
}

async function jsonToPayload(jsonObject) {
    try {
        if (!jsonObject || !get(jsonObject, 'UniversalInterchange.Body.UniversalShipment.Shipment')) {
            throw new Error('Invalid input: missing shipment data');
        }

        const shipment = get(jsonObject, 'UniversalInterchange.Body.UniversalShipment.Shipment');

        let reference = null;
        if (get(shipment, 'SubShipmentCollection.SubShipment')) {
            if (Array.isArray(get(shipment, 'SubShipmentCollection.SubShipment'))) {
                reference = get(shipment, 'SubShipmentCollection.SubShipment[0].DataContext.DataSourceCollection.DataSource.Key._text', null);
            } else {
                const dataSources = Array.isArray(get(shipment, 'SubShipmentCollection.SubShipment.DataContext.DataSourceCollection.DataSource')) ? get(shipment, 'SubShipmentCollection.SubShipment.DataContext.DataSourceCollection.DataSource') : [get(shipment, 'SubShipmentCollection.SubShipment.DataContext.DataSourceCollection.DataSource', null)];
                reference = get(dataSources, '[0].Key._text', null);
            }
        }

        const Delivered = get(shipment, 'SubShipmentCollection.SubShipment.LocalProcessing.DeliveryCartageCompleted._text', null);
        const total_number_of_pieces = parseInt(get(shipment, 'OuterPacks._text')) || null;
        const destination = shipment.PortOfDischarge?.Code?._text?.substring(2) ?? null;
        const origin = shipment.PortOfLoading?.Code?._text?.substring(2) ?? null;
        const number_of_pieces = parseInt(get(shipment, 'TotalNoOfPacks._text')) || null;
        let deliveryToName = get(shipment, 'SubShipmentCollection.SubShipment.CustomizedFieldCollection.CustomizedField[1].Value._text', null);

        const weight = {
            amount: parseInt(get(shipment, 'TotalWeight._text')) || null,
            unit: get(shipment, 'TotalWeightUnit.Code._text', null)
        };
        const air_waybill_number = get(shipment, 'WayBillNumber._text', null);
        let events = [];
        if (get(shipment, 'TransportLegCollection.TransportLeg')) {
            let transportLegs = get(shipment, 'TransportLegCollection.TransportLeg');
            if (!Array.isArray(transportLegs)) {
                transportLegs = [transportLegs];
            }
            events = transportLegs.reduce((events, transport_leg) => {
                const commonEventData = {
                    destination: transport_leg.PortOfDischarge?.Code?._text?.substring(2) ?? null,
                    origin: transport_leg.PortOfLoading?.Code?._text?.substring(2) ?? null,
                };
                if (get(transport_leg, 'ScheduledDeparture._text')) {
                    const bookedEvent = {
                        type: "booked",
                        ...commonEventData,
                        timeOfEvent: get(transport_leg, 'ScheduledDeparture._text'),
                        estimatedTimeOfArrival: get(transport_leg, 'EstimatedArrival._text', null),
                        dateOfScheduledDeparture: get(transport_leg, 'EstimatedDeparture._text', null),
                        timeOfScheduledArrival: get(transport_leg, 'ScheduledArrival._text', null),
                        timeOfScheduledDeparture: get(transport_leg, 'ScheduledDeparture._text', null),
                        flight: get(transport_leg, 'VoyageFlightNo._text', null)
                    };
                    events.push(bookedEvent);
                }

                if (get(transport_leg, 'ActualDeparture._text')) {
                    const departedEvent = {
                        type: "departed",
                        ...commonEventData,
                        timeOfEvent: get(transport_leg, 'ActualDeparture._text', null),
                        estimatedTimeOfArrival: get(transport_leg, 'EstimatedArrival._text', null),
                        timeOfScheduledArrival: get(transport_leg, 'ScheduledArrival._text', null),
                        flight: get(transport_leg, 'VoyageFlightNo._text', null)
                    };
                    events.push(departedEvent);
                }

                if (get(transport_leg, 'ActualArrival._text')) {
                    const arrivedEvent = {
                        type: "arrived",
                        ...commonEventData,
                        timeOfEvent: get(transport_leg, 'ActualArrival._text', null),
                        flight: get(transport_leg, 'VoyageFlightNo._text', null)
                    };
                    events.push(arrivedEvent);
                }

                return events;
            }, events);
        }

        if (Delivered) {
            const deliveredEvent = {
                type: "delivered",
                deliveryToName,
                timeOfEvent: Delivered,
            };
            events.push(deliveredEvent);
        }

        const payload = {
            type: "flight status",
            totalNumberOfPieces: total_number_of_pieces,
            destination,
            origin,
            quantity: {
                shipmentDescriptionCode: "TOTAL_CONSIGNMENT",
                numberOfPieces: number_of_pieces,
                weight
            },
            airWaybillNumber: air_waybill_number,
            events
        };

        return { reference, payloadType: "Mawb", payload };

    } catch (error) {
        console.error(error);
        throw error;
    }
}



async function sendPayload(payload) {
    let data = JSON.stringify(payload);

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: process.env.SPACEX_AIR_ENDPOINT,
        headers: {
            'eventType': 'airMilestoneUpdate',
            'Content-Type': 'application/json',
            'apikey': process.env.SPACEX_AIR_APIKEY,
            'Connection': 'keep-alive',
            'Accept': 'application/json'
        },
        data: data
    };
    try {
        const response = await axios.request(config);
        console.info("Payload is sent successfully", JSON.stringify(response.data));
        return {
            success: true,
            errorMsg: "",
            responseStatus: response.status
        };
    } catch (error) {
        console.error(error);
        return {
            success: false,
            errorMsg: get(error, 'response.data.errors[0].message', ''),
            responseStatus: get(error, 'response.status', 0)
        };
    }
}

async function putItem(tableName, item) {
    let params;
    try {
        params = {
            TableName: tableName,
            Item: item,
        };
        return await dynamodb.put(params).promise();
    } catch (e) {
        console.error("Put Item Error: ", e, "\nPut params: ", params);
    }
}

module.exports = {
    xmlToJson,
    containsUniversalShipment,
    isTransportModeAir,
    getReferenceNo,
    callEAdapterAPI,
    jsonToPayload,
    sendPayload,
    putItem
}
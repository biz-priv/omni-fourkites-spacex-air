const AWS = require("aws-sdk");
const convert = require("xml-js");
const axios = require("axios")
const dynamodb = new AWS.DynamoDB.DocumentClient();




async function xmlToJson(xml) {
    try {
        if (!xml) {
            throw new Error("Invalid XML input");
        }

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
        if (!jsonObject || !jsonObject.UniversalInterchange.Body.UniversalShipment) {
            throw new Error("Invalid JSON object");
        }
        console.log("jsonObject is not null", jsonObject.UniversalInterchange.Body.UniversalShipment != null);
        return jsonObject.UniversalInterchange.Body.UniversalShipment != null;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function isTransportModeAir(jsonObject) {
    try {
        if (!jsonObject || !jsonObject.UniversalInterchange.Body.UniversalShipment || !jsonObject.UniversalInterchange.Body.UniversalShipment.Shipment) {
            throw new Error("Invalid JSON object or missing shipment data");
        }
        return jsonObject.UniversalInterchange.Body.UniversalShipment.Shipment.TransportMode.Code._text === 'AIR';
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function getReferenceNo(jsonObject) {
    try {
        const shipment = jsonObject?.UniversalInterchange?.Body?.UniversalShipment?.Shipment;
        let reference = null;
        if (shipment?.SubShipmentCollection?.SubShipment) {
            if (Array.isArray(shipment.SubShipmentCollection.SubShipment)) {
                reference = shipment.SubShipmentCollection.SubShipment[0]?.DataContext?.DataSourceCollection?.DataSource?.Key?._text ?? null;
            } else {
                const dataSources = Array.isArray(shipment.SubShipmentCollection.SubShipment.DataContext?.DataSourceCollection?.DataSource) ? shipment.SubShipmentCollection.SubShipment.DataContext.DataSourceCollection.DataSource : [shipment.SubShipmentCollection.SubShipment.DataContext?.DataSourceCollection?.DataSource];
                reference = dataSources[0]?.Key?._text ?? null;
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
        const endpoint = 'https://trxts2services.wisegrid.net/eAdaptor';
        const xmlBody = generateXmlBody(jsonObject);

        const response = await axios.post(endpoint, xmlBody, {
            headers: {
                'Content-Type': 'application/xml',
                Authorization: 'Basic dHJ4dHMyOjY0ODg1Nw==',
            },
        });

        if (response.status !== 200) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        const jsonResponse = await xmlToJson(response.data);
        console.log("jsonResponse:", jsonResponse);

        const transportMode = getTransportMode(jsonResponse);
        console.log("transportMode:", transportMode);

        return transportMode;
    } catch (error) {
        console.error(error);
        throw error;
    }
}



function getTransportMode(jsonResponse) {
    try {
        return jsonResponse?.UniversalResponse?.Data?.UniversalShipment?.Shipment?.TransportMode.Code._text;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

async function jsonToPayload(jsonObject) {
    try {

        if (!jsonObject || !jsonObject.UniversalInterchange.Body.UniversalShipment || !jsonObject.UniversalInterchange.Body.UniversalShipment.Shipment) {
            throw new Error('Invalid input: missing shipment data');
        }

        const shipment = jsonObject.UniversalInterchange.Body.UniversalShipment.Shipment;

        let reference = null;
        if (shipment.SubShipmentCollection?.SubShipment) {
            if (Array.isArray(shipment.SubShipmentCollection.SubShipment)) {
                reference = shipment.SubShipmentCollection.SubShipment[0]?.DataContext?.DataSourceCollection?.DataSource?.Key?._text ?? reference;
            } else {
                const dataSources = Array.isArray(shipment.SubShipmentCollection.SubShipment.DataContext?.DataSourceCollection?.DataSource) ? shipment.SubShipmentCollection.SubShipment.DataContext.DataSourceCollection.DataSource : [shipment.SubShipmentCollection.SubShipment.DataContext?.DataSourceCollection?.DataSource];
                reference = dataSources[0]?.Key?._text ?? reference;
            }
        }
        // console.log(shipment.SubShipmentCollection.SubShipment[0].DataContext.DataSourceCollection.DataSource.Key._text)
        const Delivered = shipment.SubShipmentCollection.SubShipment.LocalProcessing?.DeliveryCartageCompleted?._text ?? null
        const total_number_of_pieces = parseInt(shipment.OuterPacks?._text) || null;
        const destination = shipment.PortOfDischarge?.Code?._text?.substring(2) ?? null;
        const origin = shipment.PortOfLoading?.Code?._text?.substring(2) ?? null;
        const number_of_pieces = parseInt(shipment.TotalNoOfPacks?._text) || null;
        let deliveryToName = shipment.SubShipmentCollection.SubShipment.CustomizedFieldCollection.CustomizedField[1].Value?._text ?? null;

        const weight = {
            amount: parseInt(shipment.TotalWeight?._text) || null,
            unit: shipment.TotalWeightUnit?.Code?._text ?? null
        };
        const air_waybill_number = shipment.WayBillNumber?._text ?? null;
        let events = [];
        if (shipment.TransportLegCollection && shipment.TransportLegCollection.TransportLeg) {
            let transportLegs = shipment.TransportLegCollection.TransportLeg;
            if (!Array.isArray(transportLegs)) {
                transportLegs = [transportLegs];
            }
            events = transportLegs.reduce((events, transport_leg) => {
                const commonEventData = {
                    destination: transport_leg.PortOfDischarge?.Code?._text?.substring(2) ?? null,
                    origin: transport_leg.PortOfLoading?.Code?._text?.substring(2) ?? null,
                };
                if (transport_leg.ScheduledDeparture?._text) {
                    const bookedEvent = {
                        type: "booked",
                        ...commonEventData,
                        timeOfEvent: transport_leg.ScheduledDeparture._text,
                        estimatedTimeOfArrival: transport_leg.EstimatedArrival?._text ?? null,
                        dateOfScheduledDeparture: transport_leg.EstimatedDeparture?._text ?? null,
                        timeOfScheduledArrival: transport_leg.ScheduledArrival?._text ?? null,
                        timeOfScheduledDeparture: transport_leg.ScheduledDeparture._text,
                        flight: transport_leg.VoyageFlightNo?._text ?? null
                    };
                    events.push(bookedEvent);
                }

                if (transport_leg.ActualDeparture?._text) {
                    const departedEvent = {
                        type: "departed",
                        ...commonEventData,
                        timeOfEvent: transport_leg.ActualDeparture._text,
                        estimatedTimeOfArrival: transport_leg.EstimatedArrival?._text ?? null,
                        timeOfScheduledArrival: transport_leg.ScheduledArrival?._text ?? null,
                        flight: transport_leg.VoyageFlightNo?._text ?? null
                    };
                    events.push(departedEvent);
                }

                if (transport_leg.ActualArrival?._text) {
                    const arrivedEvent = {
                        type: "arrived",
                        ...commonEventData,
                        timeOfEvent: transport_leg.ActualArrival._text,
                        flight: transport_leg.VoyageFlightNo?._text ?? null
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
        url: 'https://api.fourkites.com/data-providers/events/async',
        headers: {
            'eventType': 'airMilestoneUpdate',
            'Content-Type': 'application/json',
            'apikey': 'JKT5RI8LG4EPL87L2REK3A1T3TII9',
            'Connection': 'keep-alive',
            'Accept': 'application/json'
        },
        data: data
    };
    try {
        const response = await axios.request(config);
        console.log("Payload is sent successfully", JSON.stringify(response.data));
        return {
            success: true,
            errorMsg: "",
            responseStatus: response.status
        };
    } catch (error) {
        console.error(error);
        return {
            success: false,
            errorMsg: error.response.data.errors[0].message,
            responseStatus: error.response.status
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
        throw "PutItemError";
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
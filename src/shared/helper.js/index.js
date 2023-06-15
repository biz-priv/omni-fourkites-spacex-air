const AWS = require("aws-sdk");
const convert = require("xml-js");
const axios = require("axios")



async function xmlToJson(xml) {
    try {
        xml = xml.toString("utf-8");
        xml = xml.replace("&", "*AND*");
        let json_data = convert.xml2json(xml, { compact: true, spaces: 4 });
        json_data = JSON.parse(json_data);
        return json_data;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function containsUniversalShipment(jsonObject) {
    console.log(jsonObject?.UniversalInterchange?.Body?.UniversalShipment != null);
    return jsonObject?.UniversalInterchange?.Body?.UniversalShipment != null;
}

function isTransportModeAir(jsonObject) {
    console.log(jsonObject?.UniversalInterchange?.Body?.UniversalShipment?.Shipment?.TransportMode?.Code._text === 'AIR');
    return jsonObject?.UniversalInterchange?.Body?.UniversalShipment?.Shipment?.TransportMode?.Code._text === 'AIR';
}

function getReferenceNo(jsonObject) {
    const shipment = jsonObject?.UniversalInterchange.Body.UniversalShipment.Shipment;
    const reference = shipment.DataContext.DataSourceCollection.DataSource.Key._text;
    return reference;
}

function generateXmlBody(jsonObject) {
    // Generate the XML body for eAdapter request using the jsonObject and reference number
    // Return the XML body as a string
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
}
async function callEAdapterAPI(jsonObject) {
    try {
        const endpoint = 'https://trxts2services.wisegrid.net/eAdaptor';
        const xmlBody = generateXmlBody(jsonObject);

        // Make API request to eAdapter
        const response = await axios.post(endpoint, xmlBody, {
            headers: {
                'Content-Type': 'application/xml',
                Authorization: 'Basic dHJ4dHMyOjY0ODg1Nw==',
            },
        });

        // Convert XML response to JSON object
        const jsonResponse = await xmlToJson(response.data);
        console.log("jsonResponse:", jsonResponse);

        // Extract transport mode from JSON response
        const transportMode = getTransportMode(jsonResponse);
        console.log("transportMode:", transportMode);
        return transportMode;
    } catch (error) {
        console.error(error);
    }
}


function getTransportMode(jsonResponse) {
    return jsonResponse?.UniversalResponse?.Data?.UniversalShipment?.Shipment?.TransportMode.Code._text
}

async function jsonToPayload(jsonObject) {
    const shipment = jsonObject.UniversalInterchange.Body.UniversalShipment.Shipment;
    const reference = shipment.DataContext.DataSourceCollection.DataSource.Key._text;
    const Delivered = shipment.LocalProcessing.DeliveryCartageCompleted._text
    const total_number_of_pieces = parseInt(shipment.OuterPacks._text);
    const destination = shipment.PortOfDischarge.Code._text.substring(2);
    const origin = shipment.PortOfLoading.Code._text.substring(2);
    const number_of_pieces = parseInt(shipment.TotalNoOfPacks._text);

    const weight = {
        amount: parseInt(shipment.TotalWeight._text),
        unit: shipment.TotalWeightUnit.Code._text
    };
    const air_waybill_number = shipment.WayBillNumber._text;
    let events = [];

    events = shipment.TransportLegCollection.TransportLeg.reduce((events, transport_leg) => {

        const commonEventData = {
            destination: transport_leg.PortOfDischarge.Code._text.substring(2),
            origin: transport_leg.PortOfLoading.Code._text.substring(2),
        };

        const bookedEvent = {
            type: "booked",
            ...commonEventData,
            timeOfEvent: transport_leg.ScheduledDeparture._text,
            estimatedTimeOfArrival: transport_leg.EstimatedArrival._text,
            dateOfScheduledDeparture: transport_leg.EstimatedDeparture._text,
            timeOfScheduledArrival: transport_leg.ScheduledArrival._text,
            timeOfScheduledDeparture: transport_leg.ScheduledDeparture._text,
            flight: transport_leg.VoyageFlightNo._text
        };
        const departedEvent = {
            type: "departed",
            ...commonEventData,
            timeOfEvent: transport_leg.ActualDeparture._text,
            estimatedTimeOfArrival: transport_leg.EstimatedArrival._text,
            timeOfScheduledArrival: transport_leg.ScheduledArrival._text,
            flight: transport_leg.VoyageFlightNo._text
        };
        const arrivedEvent = {
            type: "arrived",
            ...commonEventData,
            timeOfEvent: transport_leg.ActualArrival._text,
            flight: transport_leg.VoyageFlightNo._text
        };
        // const deliveredEvent = {
        //   type: "delivered",
        //   deliveryToName: shipment.CustomizedFieldCollection.CustomizedField.Value._text,
        //   timeOfEvent: Delivered,
        // };
        events.push(bookedEvent);
        events.push(departedEvent);
        events.push(arrivedEvent);
        // eventMap.delivered.push(deliveredEvent);
        return events;
    }, events);
    const deliveredEvent = {
        type: "delivered",
        deliveryToName: shipment.CustomizedFieldCollection.CustomizedField.Value._text,
        timeOfEvent: Delivered,
    };

    events.push(deliveredEvent);
    const payload = {
        type: "flight status",
        totalNumberOfPieces: total_number_of_pieces,
        destination: destination,
        origin: origin,
        quantity: {
            shipmentDescriptionCode: "TOTAL_CONSIGNMENT",
            numberOfPieces: number_of_pieces,
            weight: Object.assign({}, weight)
        },
        airWaybillNumber: air_waybill_number,
        events: events
    };

    return { reference: reference, payloadType: "Mawb", payload: payload };
}


async function sendPayload(payload) {
    let data = JSON.stringify(payload);

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://api-staging.fourkites.com/data-providers/events/async',
        headers: {
            'eventType': 'airMilestoneUpdate',
            'Content-Type': 'application/json',
            'apikey': 'JKT5RI8LG4EPL87L2REK3A1T3TII9'
        },
        data: data
    };

    try {
        const response = await axios.request(config);
        console.log(JSON.stringify(response.data));
    } catch (error) {
        console.log(error);
    }
}

module.exports = {
    xmlToJson,
    containsUniversalShipment,
    isTransportModeAir,
    getReferenceNo,
    callEAdapterAPI,
    jsonToPayload,
    sendPayload
}
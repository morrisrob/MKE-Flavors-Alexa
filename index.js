const Alexa = require("ask-sdk-core");
let locations;

const messages = {
  WELCOME:
    "Welcome to MKE Flavors!  You can ask what is the flavor at a particular location, or what are the flavors near me.  What would you like to ask?",
  WHAT_DO_YOU_WANT: "What do you want to ask?",
  NOTIFY_MISSING_PERMISSIONS:
    "Sorry, it looks like you have not allowed Milwaukee Flavors to access your location.  Please enable Location permissions in the Amazon Alexa app.",
  NO_ADDRESS:
    "Sorry, it looks like you don't have an address set. You can set your address from the Alexa app.",
  ERROR: "Uh Oh. Looks like something went wrong.",
  LOCATION_FAILURE:
    "Sorry, it looks like we weren't able to determine your location. Please try again.",
  GOODBYE: "Thanks for using MKE Flavors! Bye!",
  UNHANDLED:
    "Sorry, This skill doesn't support that. Please ask something else. For a list of supported commands, say help",
  HELP:
    "You can say, what is the flavor at a particular location, or what are the closest locations",
  STOP: "Thanks for using MKE Flavors! Bye!",
  INVALID_LOCATION:
    "Sorry, this skill does not support your location.  This skill provides flavors for Milwaukee area frozen custard locations.  Thank you for using MKE Flavors.  Bye!"
};

const PERMISSIONS = ["read::alexa:device:all:address"];

const sortFunction = (a, b) => {
  if (a.distance === b.distance) {
    return 0;
  } else {
    return a.distance < b.distance ? -1 : 1;
  }
};

const calculateDistance = (lat1, lon1, lat2, lon2, unit) => {
  if (lat1 == lat2 && lon1 == lon2) {
    return 0;
  } else {
    var radlat1 = (Math.PI * lat1) / 180;
    var radlat2 = (Math.PI * lat2) / 180;
    var theta = lon1 - lon2;
    var radtheta = (Math.PI * theta) / 180;
    var dist =
      Math.sin(radlat1) * Math.sin(radlat2) +
      Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
    if (dist > 1) {
      dist = 1;
    }
    dist = Math.acos(dist);
    dist = (dist * 180) / Math.PI;
    dist = dist * 60 * 1.1515;
    if (unit == "K") {
      dist = dist * 1.609344;
    }
    if (unit == "N") {
      dist = dist * 0.8684;
    }
    return dist;
  }
};

//need to insert geocoder api info in URL
function getGeoLocation(address, state, zip) {
  const https = require("https");
  const url =
    "https://geocoder.api.here.com/6.2/geocode.json?app_id=<geocoderAppId>&app_code=<>geocoderAppCode&searchtext=" +
    address +
    state +
    zip;
  return new Promise((resolve, reject) => {
    const request = https.get(url, function(response) {
      var data = "";

      response.setEncoding("utf8");
      response.on("data", function(x) {
        data += x;
      });

      response.on("end", function() {
        let json = JSON.parse(data);

        if (json.Response.View[0] === undefined) {
          resolve(undefined);
        } else {
          let latLongArray = [];
          let lat =
            json.Response.View[0].Result[0].Location.NavigationPosition[0]
              .Latitude;
          let lng =
            json.Response.View[0].Result[0].Location.NavigationPosition[0]
              .Longitude;

          latLongArray.push(lat, lng);
          console.log(latLongArray);
          resolve(latLongArray);
        }
      });

      response.on("error", error => {
        reject(error);
      });
    });
    request.end();
  });
}

//fixes pronunciation of location names
function nameProcessor(name) {
  if (name === "Leducs") {
    return "Le Dukes";
  }
  if (name === "Culvers - Hwy 164") {
    return "Culvers Highway one sixty four";
  } else {
    name.replace("- ", "");
    return locName;
  }
}

function phraseProcessor(name, flavors) {
  let flavString = flavors.toString();
  let speechText = "";

  if (flavors.length > 1) {
    const multString = flavString.replace(",", " and ").replace("&", "and");
    const speechText = `The flavors at ${name} are ${multString}.  `;
    return speechText;
  } else {
    const speechText = `The flavor at ${name} is ${flavString}.  `;
    return speechText.replace("&", "and");
  }
}

function getLocations() {
  const https = require("https");
  const url = "https://mkeflavors.com/api/locations";
  return new Promise((resolve, reject) => {
    const request = https.get(url, function(response) {
      var data = "";

      response.setEncoding("utf8");
      response.on("data", function(x) {
        data += x;
      });

      response.on("end", function() {
        let json = JSON.parse(data);
        resolve(json);
      });

      response.on("error", error => {
        reject(error);
      });
    });

    request.end();
  });
}

function findFlavor(loc) {
  for (let i = 0; i < locations.length; i++) {
    if (loc == locations[i].name) {
      return locations[i].flavors;
    }
  }
}

const LaunchRequest = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "LaunchRequest";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(messages.WELCOME)
      .reprompt(messages.WHAT_DO_YOU_WANT)
      .getResponse();
  }
};

const GetClosestLocationsIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return (
      request.type === "IntentRequest" &&
      request.intent.name === "GetClosestLocationsIntent"
    );
  },
  async handle(handlerInput) {
    const {
      requestEnvelope,
      serviceClientFactory,
      responseBuilder
    } = handlerInput;

    const consentToken =
      requestEnvelope.context.System.user.permissions &&
      requestEnvelope.context.System.user.permissions.consentToken;
    if (!consentToken) {
      return responseBuilder
        .speak(messages.NOTIFY_MISSING_PERMISSIONS)
        .withAskForPermissionsConsentCard(PERMISSIONS)
        .getResponse();
    }
    try {
      const { deviceId } = requestEnvelope.context.System.device;
      const deviceAddressServiceClient = serviceClientFactory.getDeviceAddressServiceClient();
      const address = await deviceAddressServiceClient.getFullAddress(deviceId);
      let ADDRESS_MESSAGE;

      console.log("Address successfully retrieved, now responding to user.");

      let response;
      if (address.addressLine1 === null && address.stateOrRegion === null) {
        response = responseBuilder.speak(messages.NO_ADDRESS).getResponse();
      } else {
        try {
          let geoLocation = await getGeoLocation(
            address.addressLine1,
            address.stateOrRegion,
            address.postalCode
          );

          if (geoLocation === undefined) {
            ADDRESS_MESSAGE = messages.INVALID_LOCATION;

            return responseBuilder.speak(ADDRESS_MESSAGE).getResponse();
          } else {
            let locations = await getLocations();

            let lat = geoLocation[0];
            let lng = geoLocation[1];

            for (let i = 0; i < locations.length; i++) {
              const dist = calculateDistance(
                lat,
                lng,
                locations[i].lat,
                locations[i].long
              );
              locations[i].distance = dist;
            }

            locations.sort(function(a, b) {
              return a.distance - b.distance;
            });

            let speechText =
              "Here are the flavors of the day at the five locations closest to you. ";

            for (let j = 0; j < 5; j++) {
              let fixedName = nameProcessor(locations[j].name);
              let phrase = phraseProcessor(fixedName, locations[j].flavors);
              speechText += phrase;
            }

            ADDRESS_MESSAGE = speechText + ". What else can I help you with?";
          }

          return responseBuilder
            .speak(ADDRESS_MESSAGE)
            .withShouldEndSession(false)
            .getResponse();
        } catch (error) {}
      }
      return response;
    } catch (error) {
      if (error.name !== "ServiceError") {
        return responseBuilder.speak(messages.ERROR).getResponse();
      }
      throw error;
    }
  }
};

const FlavorsIntentHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      handlerInput.requestEnvelope.request.intent.name === "FlavorsIntent"
    );
  },
  async handle(handlerInput) {
    const locationSlot =
      handlerInput.requestEnvelope.request.intent.slots.Location;
    const statusCode =
      locationSlot.resolutions.resolutionsPerAuthority[0].status.code;
    console.log("status code is " + statusCode);
    let speechText;
    if (statusCode == "ER_SUCCESS_NO_MATCH") {
      speechText =
        "Sorry, we didn't catch the location name.  Please try again.";
    } else {
      const resolutionName =
        locationSlot.resolutions.resolutionsPerAuthority[0].values[0].value
          .name;
      let locationName;
      if (locationSlot && locationSlot.value) {
        locationName = locationSlot.value.toLowerCase();
      }

      locations = await getLocations();
      const flav = await findFlavor(resolutionName);
      console.log(flav);
      let locName = nameProcessor(resolutionName);

      speechText =
        phraseProcessor(locName, flav) + ". What else can I help you with?";
    }

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard(speechText)
      .withShouldEndSession(false)
      .getResponse();
  }
};

const SessionEndedRequest = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "SessionEndedRequest";
  },
  handle(handlerInput) {
    console.log(
      `Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`
    );

    return handlerInput.responseBuilder.getResponse();
  }
};

const UnhandledIntent = {
  canHandle() {
    return true;
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(messages.UNHANDLED)
      .reprompt(messages.UNHANDLED)
      .getResponse();
  }
};

const HelpIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return (
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.HelpIntent"
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(messages.HELP)
      .withShouldEndSession(false)
      .getResponse();
  }
};

const CancelIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return (
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.CancelIntent"
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak(messages.GOODBYE).getResponse();
  }
};

const StopIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return (
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.StopIntent"
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak(messages.STOP).getResponse();
  }
};

const GetAddressError = {
  canHandle(handlerInput, error) {
    return error.name === "ServiceError";
  },
  handle(handlerInput, error) {
    if (error.statusCode === 403) {
      return handlerInput.responseBuilder
        .speak(messages.NOTIFY_MISSING_PERMISSIONS)
        .withAskForPermissionsConsentCard(PERMISSIONS)
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak(messages.LOCATION_FAILURE)
      .reprompt(messages.LOCATION_FAILURE)
      .getResponse();
  }
};

const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
  .addRequestHandlers(
    LaunchRequest,
    FlavorsIntentHandler,
    GetClosestLocationsIntent,
    SessionEndedRequest,
    CancelIntent,
    HelpIntent,
    StopIntent,
    UnhandledIntent
  )
  .addErrorHandlers(GetAddressError)
  .withApiClient(new Alexa.DefaultApiClient())
  .lambda();

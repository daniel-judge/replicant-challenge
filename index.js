// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';

const functions = require('firebase-functions');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
const admin = require('firebase-admin');
const {dialogflow} = require('actions-on-google');
const app = dialogflow(); 
const fetch = require('node-fetch');

async function refreshSFToken() {
  var urlencoded = new URLSearchParams();
  urlencoded.append("grant_type", "password");
  urlencoded.append("client_id", [REDACTED]);
  urlencoded.append("client_secret", [REDACTED]);
  urlencoded.append("username", [REDACTED]);
  urlencoded.append("password", [REDACTED]);

  const getToken = await fetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST',
    body: urlencoded,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }

  });

  const r1 = await getToken.clone();
  const results = await Promise.all([getToken.json()]);
  console.log(results[0].access_token);
  return results[0].access_token;

}

async function getOrderStatus(order_number) {
  var urlGet = `https://daniel-judge-dev-ed.my.salesforce.com/services/data/v54.0/query/?q=Select+id,+order_status__c+from+case+where+CaseNumber+LIKE+'%25${order_number}'`;
  return fetch(urlGet, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await refreshSFToken()}`
      }
    }).then(res => res.json())
    .then(json_get => {
      console.log(json_get["records"][0]);
      return json_get;
    })
    .catch(err => {
      console.log(`Something did not end well on the getOrderStatus ${err}`);
    });


}

async function update_delivery(order_sf_id, address) {
  console.log(order_sf_id);

  var urlGet = `https://daniel-judge-dev-ed.my.salesforce.com/services/data/v54.0/sobjects/Case/${order_sf_id}`;
  return fetch(urlGet, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${await refreshSFToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "Delivery_Address__c": `${address}`
      })
    }).then(res => res.status)
    .then(status_get => {
      console.log(`Response from the update_delivery: ${status_get}`);
      return status_get;
    })
    .catch(err => {
      console.log(`Something did not end well on the update_delivery ${err}`);
    });
}

async function update_delivery_date(order_sf_id, date_change) {
  var urlGet = `https://daniel-judge-dev-ed.my.salesforce.com/services/data/v54.0/sobjects/Case/${order_sf_id}`;
  return fetch(urlGet, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${await refreshSFToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "Delivery_Date__c": `${date_change}`
      })
    }).then(res => res.status)
    .then(status_get => {
      console.log(`Response from the update_delivery: ${status_get}`);
      return status_get;
    })
    .catch(err => {
      console.log(`Something did not end well on the update_delivery ${err}`);
    });
}

async function sendText(to_number) {
  var urlencodedTwilio = new URLSearchParams();
  urlencodedTwilio.append("Body", "A few exemples of order numbers you can ask the status or change the delivery -> 1480 \nTo check the order -> 1346");
  urlencodedTwilio.append("To", `+${to_number}`);
  urlencodedTwilio.append("From", "+18454154396");

  return fetch('https://api.twilio.com/2010-04-01/Accounts/ACa6d56f0085ac9f9b02aeb4f19061835e/Messages.json', {
    method: 'POST',
    headers: {
      "Authorization": "Basic [REDACTED]"
    },
    body: urlencodedTwilio
  }).then(res => res.status).then(res_get => {
    return res_get;
  });
}

process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements
 

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
const agent = new WebhookClient({
    request,
    response
  });
  console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
  console.log('Dialogflow Request body: ' + JSON.stringify(request.body));

  async function order_status(agent) {
    const order_number = agent.parameters.order_number;
    const status = await getOrderStatus(order_number);
    if (status.totalSize == 0) {

      agent.add(`We could not find your order number, please try again later`);

    } else {

      agent.add(`Your order is currently ${status["records"][0].order_status__c}. Is there anything else I can help you with?`);

    }
  }

  async function send_text_number(agent) {
    const full_number = `${agent.contexts[0].parameters.countrycode}${agent.contexts[0].parameters.areacode}${agent.contexts[0].parameters.lastdigits}`;
    console.log(`Full number: ${full_number}`);
    const twilio_api_res = await sendText(full_number);
    console.log(`Twilio status: ${twilio_api_res}`);

    if (twilio_api_res != 201) {
      agent.add("This number does not seem to be valid, can you try again from the begining?");

    } else {
      agent.add(`A text should have been send to ${agent.contexts[0].parameters.countrycode}, ${agent.contexts[0].parameters.areacode}, ${agent.contexts[0].parameters.lastdigits}. Is there anything else I can help you with?`);
    }
  }


  async function change_order_address_intent(agent) {
    console.log(agent.parameters);
    const order_number = agent.parameters.ordernumberchange;
    const current_order_status = await getOrderStatus(order_number);

    try {
      if (current_order_status["records"][0].order_status__c == 'Processing') {
        const full_address = `${agent.parameters.zipcode_change} ${agent.parameters.streetname_change["street-address"]} #${agent.parameters.doornumber_change}, ${agent.parameters.cityname_change}, ${agent.parameters.state_change}`;
        update_delivery(current_order_status["records"][0].Id, full_address);
        agent.add(`Your address was updated correctly. Is there anything else I can help you with?`);

      } else {
        agent.add(`Your order is currently ${current_order_status["records"][0].order_status__c}, which does not allow to change the delivery address to be changed. Is there anything else I can help you with?`);
      }
    } catch (err) {
      console.log(err);
      agent.add("Something went wrong, please try again later.");

    }
  }

  async function delivery_date_change_possible(agent) {
    const sf_id = await getOrderStatus(agent.contexts[0].parameters.ordernumbercheck);
    const update_status = await update_delivery_date(sf_id["records"][0].Id, (agent.contexts[0].parameters.datechanged).substring(0, 10));
    
    if (update_status == 204) {
      agent.add(`The delivery date was updated to ${(agent.contexts[0].parameters.datechanged).substring(0,10)}. Is there anything else I can help you with?`);

    } else agent.add("Something went wrong, please try again later.");

  }

  async function change_delivery_date_intent(agent) {
    const order_number = agent.parameters.ordernumbercheck;
    const current_order_status = await getOrderStatus(order_number);

    if (current_order_status.totalSize == 0) {

      agent.add("We did not found the order number you provided. Is there anything else I can help you with?");

    } else {

      if (current_order_status["records"][0].order_status__c === 'Processing') {

        agent.add("What is the date?");

      } else {

        agent.add(`Your order is currently ${current_order_status["records"][0].order_status__c}, which does not allow to change the delivery address to be changed. Is there anything else I can help you with?`);

      }

    }
  }


  let intentMap = new Map(); // Map functions to Dialogflow intent names
  intentMap.set('Check order status', order_status);
  intentMap.set('Last digits of number (Text)', send_text_number);
  intentMap.set('Change order address intent(main)', change_order_address_intent);
  intentMap.set('Change Delivery date intent', change_delivery_date_intent);
  intentMap.set('Delivery date change possible', delivery_date_change_possible);
  agent.handleRequest(intentMap);
});

import { ApiKeyCredentials } from '@azure/ms-rest-js';
import { LUISAuthoringClient } from  '@azure/cognitiveservices-luis-authoring';
import { LUISRuntimeClient } from '@azure/cognitiveservices-luis-runtime';

const { AUTHORING_KEY, AUTHORING_RESOURCE_NAME, PREDICTION_RESOURCE_NAME } = process.env;

const authoringEndpoint = `https://${AUTHORING_RESOURCE_NAME}.cognitiveservices.azure.com/`;
const predictionEndpoint = `https://${PREDICTION_RESOURCE_NAME}.cognitiveservices.azure.com/`;

const getModelGrandchild = (model: any, childName: any, grandchildName: any) => model.children.find((c: any) => c.name === childName).children.find((c: any) => c.name === grandchildName).id;

const quickstart = async () => {
  const luisAuthoringCredentials = new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': AUTHORING_KEY } });
  const { apps, model, features, examples, train } = new LUISAuthoringClient(luisAuthoringCredentials, authoringEndpoint);
  const { prediction } = new LUISRuntimeClient(luisAuthoringCredentials, predictionEndpoint);

  const appName = 'Contoso Pizza Company';
  const versionId = '0.1';
  const intentName = 'OrderPizzaIntent';

  const createAppPayload = {
    name: appName,
    initialVersionId: versionId,
    culture: 'en-us'
  };
  const { body: appId } = await apps.add(createAppPayload);

  await model.addIntent(appId, versionId, {name: intentName});

  // Add Prebuilt entity
  await model.addPrebuilt(appId, versionId, ['number']);

  // Define ml entity with children and grandchildren
  const mlEntityDefinition = {
    name: 'Pizza order',
    children: [
      {name: 'Pizza', children: [
        { name: 'Quantity' },
        { name: 'Type' },
        { name: 'Size' }
      ]},
      {name: 'Toppings', children: [
        { name: 'Type' },
        { name: 'Quantity' }
      ]}
    ]
  };

  // Add ML entity 
  const { body: mlEntityId } = await model.addEntity(appId, versionId, mlEntityDefinition);

  // Add phraselist feature
  const { body: phraseListId } = await features.addPhraseList(appId, versionId, {
    enabledForAllModels: false,
    isExchangeable: true,
    name: 'QuantityPhraselist',
    phrases: 'few,more,extra'
  });

  // Get entity and subentities
  const entityModel = await model.getEntity(appId, versionId, mlEntityId);
  const toppingQuantityId = getModelGrandchild(entityModel, 'Toppings', 'Quantity');
  const pizzaQuantityId = getModelGrandchild(entityModel, 'Pizza', 'Quantity');

  // add model as feature to subentity model
  await features.addEntityFeature(appId, versionId, pizzaQuantityId, { modelName: 'number', isRequired: true });
  await features.addEntityFeature(appId, versionId, toppingQuantityId, { modelName: 'number' });

  // add phrase list as feature to subentity model
  await features.addEntityFeature(appId, versionId, phraseListId.toString(), { featureName: 'QuantityPhraselist' });

  // Define labeled example
  const labeledExampleUtteranceWithMLEntity =
  {
    text: 'I want two small seafood pizzas with extra cheese.',
    intentName,
    entityLabels: [
      {
        startCharIndex: 7,
        endCharIndex: 48,
        entityName: 'Pizza order',
        children: [
          {
            startCharIndex: 7,
            endCharIndex: 30,
            entityName: 'Pizza',
            children: [
              {startCharIndex: 7, endCharIndex: 9, entityName: 'Quantity'},
              {startCharIndex: 11, endCharIndex: 15, entityName: 'Size'},
              {startCharIndex: 17, endCharIndex: 23, entityName: 'Type'}
            ]
          },
          {
            startCharIndex: 37,
            endCharIndex: 48,
            entityName: 'Toppings',
            children: [
              {startCharIndex: 37, endCharIndex: 41, entityName: 'Quantity'},
              {startCharIndex: 43, endCharIndex: 48, entityName: 'Type'}
            ]
          }
        ]
      }
    ]
  };

  console.log('Labeled Example Utterance:', JSON.stringify(labeledExampleUtteranceWithMLEntity, null, 2));

  // Add an example for the entity.
  // Enable nested children to allow using multiple models with the same name.
  // The quantity subentity and the phraselist could have the same exact name if this is set to True
  await examples.add(appId, versionId, labeledExampleUtteranceWithMLEntity, { enableNestedChildren: true });

  await train.trainVersion(appId, versionId);
  while (true) {
    const status = await train.getStatus(appId, versionId);
    if (status.every(m => m.details!.status === 'Success')) {
        // Assumes that we never fail, and that eventually we'll always succeed.
        break;
    }
  }

  await apps.publish(appId, { versionId, isStaging: false });

  // Production == slot name
  const request = { query: 'I want two small pepperoni pizzas with more salsa' };
  const { prediction: mlPrediction } = await prediction.getSlotPrediction(appId, 'Production', request);
  console.log(JSON.stringify(mlPrediction, null, 2));
};

try {
  await quickstart();
  console.log('Done');
} catch (e) { console.error(e) };
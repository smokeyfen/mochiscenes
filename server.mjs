import { createServer } from 'node:http';
import { GoogleGenAI } from '@google/genai';

const PORT = Number(process.env.PORT || 8787);
const ANALYSIS_MODEL = process.env.GEMINI_ANALYSIS_MODEL || 'gemini-3.8-flash';
const SELECTION_MODEL = process.env.GEMINI_SELECTION_MODEL || ANALYSIS_MODEL;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    request.on('data', (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        settled = true;
        reject(new Error('Request body is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object.');
  }
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, 'images')) {
    throw new Error('Request body must contain only images.');
  }
  if (!Array.isArray(value.images) || value.images.length < 1 || value.images.length > 5) {
    throw new Error('images must be an array containing 1 to 5 items.');
  }

  value.images.forEach((image, index) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      throw new Error(`images[${index}] must be an object.`);
    }
    const keys = Object.keys(image);
    if (keys.length !== 2 || !Object.hasOwn(image, 'base64') || !Object.hasOwn(image, 'mimeType')) {
      throw new Error(`images[${index}] must contain only base64 and mimeType.`);
    }
    if (typeof image.base64 !== 'string' || !image.base64.trim()) {
      throw new Error(`images[${index}].base64 must be a non-empty string.`);
    }
    if (typeof image.mimeType !== 'string' ||
        !image.mimeType.startsWith('image/') ||
        image.mimeType.length <= 'image/'.length) {
      throw new Error(`images[${index}].mimeType must be a non-empty image/* string.`);
    }
  });

  return value.images;
}

function createResponseSchema(imageCount) {
  const analysisProperties = {
    inputIndex: {
      type: 'integer',
      minimum: 0,
      maximum: imageCount - 1,
      description: 'Zero-based index of the corresponding input image.',
    },
    productDescription: { type: 'string' },
    colorsAndVariants: { type: 'string' },
    packagingAndAccessories: { type: 'string' },
    clutterAndWatermarks: { type: 'string' },
    humanPresence: { type: 'string' },
    visualEvidence: { type: 'string' },
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['generalSummary', 'analyses'],
    properties: {
      generalSummary: { type: 'string' },
      analyses: {
        type: 'array',
        minItems: imageCount,
        maxItems: imageCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(analysisProperties),
          properties: analysisProperties,
        },
      },
    },
  };
}

function createInstruction(imageCount) {
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth'];
  const indexGuide = Array.from(
    { length: imageCount },
    (_, index) => `${ordinals[index]} image = inputIndex ${index}`,
  ).join('; ');

  return `Analyze all ${imageCount} product reference images in one pass. Return JSON matching the provided schema with exactly one analysis per input image. Use zero-based inputIndex only. Ordered mapping: ${indexGuide}. The final image is inputIndex ${imageCount - 1}. Never use 1-based indexing. Include every inputIndex from 0 through ${imageCount - 1} exactly once. Describe only visible evidence. Do not reproduce or invent image UUIDs.`;
}

function validateSelectionRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object.');
  }
  if (Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'references') ||
      !Object.hasOwn(value, 'scenes')) {
    throw new Error('Request body must contain only references and scenes.');
  }
  if (!Array.isArray(value.references) || value.references.length < 1 || value.references.length > 5) {
    throw new Error('references must be an array containing 1 to 5 items.');
  }
  if (!Array.isArray(value.scenes) || value.scenes.length !== 4) {
    throw new Error('scenes must contain exactly 4 items.');
  }

  const referenceFields = [
    'productDescription',
    'colorsAndVariants',
    'packagingAndAccessories',
    'clutterAndWatermarks',
    'humanPresence',
    'visualEvidence',
  ];
  const referenceIndices = new Set();
  value.references.forEach((reference, position) => {
    const label = `references[${position}]`;
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw new Error(`${label} must be an object.`);
    }
    if (Object.keys(reference).length !== referenceFields.length + 1 ||
        !Object.hasOwn(reference, 'inputIndex') ||
        !referenceFields.every((field) => Object.hasOwn(reference, field))) {
      throw new Error(`${label} contains missing or unsupported fields.`);
    }
    if (!Number.isInteger(reference.inputIndex) ||
        reference.inputIndex < 0 ||
        reference.inputIndex >= value.references.length) {
      throw new Error(`${label}.inputIndex must be a zero-based integer within references.`);
    }
    if (referenceIndices.has(reference.inputIndex)) {
      throw new Error(`references contains duplicate inputIndex ${reference.inputIndex}.`);
    }
    referenceIndices.add(reference.inputIndex);
    for (const field of referenceFields) {
      if (typeof reference[field] !== 'string') {
        throw new Error(`${label}.${field} must be a string.`);
      }
    }
  });
  for (let inputIndex = 0; inputIndex < value.references.length; inputIndex += 1) {
    if (!referenceIndices.has(inputIndex)) {
      throw new Error(`references is missing inputIndex ${inputIndex}.`);
    }
  }

  const sceneModes = new Set(['PRESENTATION', 'DEMONSTRATION']);
  const sceneActions = new Set([
    'PRESENT',
    'MOVE',
    'REORIENT',
    'PRESS_RELEASE',
    'OPEN',
    'CLOSE',
    'CONNECT',
    'DISCONNECT',
    'REMOVE',
  ]);
  const cameraIntents = new Set([
    'OVERVIEW_REVEAL',
    'ACTION_READABILITY',
    'DETAIL_INSPECTION',
    'PRODUCT_PRESENTATION',
  ]);
  const sceneNumbers = new Set();
  value.scenes.forEach((scene, position) => {
    const label = `scenes[${position}]`;
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
      throw new Error(`${label} must be an object.`);
    }
    const sceneFields = [
      'sceneNumber',
      'productName',
      'sceneMode',
      'action',
      'cameraIntent',
      'dialogue',
    ];
    if (Object.keys(scene).length !== sceneFields.length ||
        !sceneFields.every((field) => Object.hasOwn(scene, field))) {
      throw new Error(`${label} contains missing or unsupported fields.`);
    }
    if (!Number.isInteger(scene.sceneNumber) || scene.sceneNumber < 1 || scene.sceneNumber > 4) {
      throw new Error(`${label}.sceneNumber must be an integer from 1 to 4.`);
    }
    if (sceneNumbers.has(scene.sceneNumber)) {
      throw new Error(`scenes contains duplicate sceneNumber ${scene.sceneNumber}.`);
    }
    sceneNumbers.add(scene.sceneNumber);
    if (typeof scene.productName !== 'string') {
      throw new Error(`${label}.productName must be a string.`);
    }
    if (!sceneModes.has(scene.sceneMode)) {
      throw new Error(`${label}.sceneMode is invalid.`);
    }
    if (!sceneActions.has(scene.action)) {
      throw new Error(`${label}.action is invalid.`);
    }
    if (!cameraIntents.has(scene.cameraIntent)) {
      throw new Error(`${label}.cameraIntent is invalid.`);
    }
    if (typeof scene.dialogue !== 'string') {
      throw new Error(`${label}.dialogue must be a string.`);
    }
  });
  for (let sceneNumber = 1; sceneNumber <= 4; sceneNumber += 1) {
    if (!sceneNumbers.has(sceneNumber)) {
      throw new Error(`scenes is missing sceneNumber ${sceneNumber}.`);
    }
  }

  return { references: value.references, scenes: value.scenes };
}

function createSelectionResponseSchema(referenceCount) {
  return {
    type: 'object',
    required: ['selections'],
    properties: {
      selections: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        items: {
          type: 'object',
          required: ['sceneNumber', 'selectedIndices', 'reason'],
          properties: {
            sceneNumber: { type: 'integer', minimum: 1, maximum: 4 },
            selectedIndices: {
              type: 'array',
              minItems: 1,
              maxItems: referenceCount,
              items: { type: 'integer', minimum: 0, maximum: referenceCount - 1 },
            },
            reason: { type: 'string' },
          },
        },
      },
    },
  };
}

async function handleSelectReferences(request, response) {
  let selectionInput;
  try {
    const rawBody = await readBody(request);
    selectionInput = validateSelectionRequest(JSON.parse(rawBody));
  } catch (error) {
    const message = error instanceof SyntaxError
      ? 'Request body must be valid JSON.'
      : error instanceof Error ? error.message : 'Invalid request.';
    sendJson(response, message === 'Request body is too large.' ? 413 : 400, { error: message });
    return;
  }

  const selectionInstruction = 'Match 4 scenes to refs by visual evidence. Output zero-based indices, never UUIDs. Every scene needs >=1 ref; reuse is allowed and not all refs are required. DETAIL_INSPECTION: favor detail. OVERVIEW_REVEAL/PRODUCT_PRESENTATION: favor clean full-product/context. DEMONSTRATION/ACTION: claim action only if visualEvidence supports it; otherwise choose identity evidence and say action is not evidenced. Never invent unsupported motion, mechanisms, features, packaging, accessories, or human interaction. Multiple refs only when complementary.';
  const finalSelectionPrompt = `${selectionInstruction}\nDATA:${JSON.stringify(selectionInput)}`;

  if (finalSelectionPrompt.length > 3800) {
    sendJson(response, 400, { error: 'Selection prompt exceeds 3800 character limit.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendJson(response, 503, { error: 'GEMINI_API_KEY is not configured.' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: SELECTION_MODEL,
      contents: finalSelectionPrompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: createSelectionResponseSchema(selectionInput.references.length),
      },
    });

    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(result.text || '');
  } catch {
    sendJson(response, 502, { error: 'Gemini reference selection failed.' });
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

  if (requestUrl.pathname === '/api/select-references') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    await handleSelectReferences(request, response);
    return;
  }

  if (requestUrl.pathname !== '/api/analyze-library') {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  let images;
  try {
    const rawBody = await readBody(request);
    images = validateRequest(JSON.parse(rawBody));
  } catch (error) {
    const message = error instanceof SyntaxError
      ? 'Request body must be valid JSON.'
      : error instanceof Error ? error.message : 'Invalid request.';
    sendJson(response, message === 'Request body is too large.' ? 413 : 400, { error: message });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendJson(response, 503, { error: 'GEMINI_API_KEY is not configured.' });
    return;
  }

  const parts = [
    { text: createInstruction(images.length) },
    ...images.flatMap((image, inputIndex) => [
      { text: `IMAGE_INDEX ${inputIndex}` },
      { inlineData: { data: image.base64, mimeType: image.mimeType } },
    ]),
  ];

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: createResponseSchema(images.length),
      },
    });

    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(result.text || '');
  } catch {
    sendJson(response, 502, { error: 'Gemini reference analysis failed.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mochi Scenes analysis server listening on http://127.0.0.1:${PORT}`);
  console.log(`Reference analysis model: ${ANALYSIS_MODEL}`);
});

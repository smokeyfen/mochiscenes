import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type {
  CompiledPromptSetV2,
  CompiledScenePromptV2,
  LibraryAnalysis,
  ReferenceImage,
  SceneSelection,
} from './types';

const MAX_REFERENCES = 5;

type PreparedReference = {
  localId: string;
  name: string;
  mimeType: string;
  base64: string;
  preparationMode: 'REENCODED' | 'ORIGINAL_FALLBACK';
  clutterAndWatermarks: string;
  humanPresence: string;
};

type PreparedScene = {
  sceneNumber: 1 | 2 | 3 | 4;
  preparedReferences: PreparedReference[];
};

type SceneGenerationPackage = {
  sceneNumber: 1 | 2 | 3 | 4;
  finalPrompt: string;
  voiceGender: 'FEMALE' | 'MALE';
  aspectRatio: '9:16';
  durationSeconds: 8;
  references: PreparedReference[];
};

function validateCompiledPromptSet(value: unknown): asserts value is CompiledPromptSetV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CompiledPromptSetV2 must be a JSON object.');
  }

  const compiledSet = value as Record<string, unknown>;

  if (compiledSet.compilerVersion !== 1) {
    throw new Error('compilerVersion must be the numeric literal 1.');
  }
  if (typeof compiledSet.sourceFingerprint !== 'string' || !compiledSet.sourceFingerprint.trim()) {
    throw new Error('sourceFingerprint must be a non-empty string.');
  }
  if (compiledSet.voiceGender !== 'FEMALE' && compiledSet.voiceGender !== 'MALE') {
    throw new Error('voiceGender must be exactly FEMALE or MALE.');
  }
  if (!Array.isArray(compiledSet.scenes) || compiledSet.scenes.length !== 4) {
    throw new Error('scenes must contain exactly 4 entries.');
  }

  const sceneNumbers = new Set<number>();
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

  compiledSet.scenes.forEach((sceneValue, index) => {
    const label = `scenes[${index}]`;
    if (!sceneValue || typeof sceneValue !== 'object' || Array.isArray(sceneValue)) {
      throw new Error(`${label} must be an object.`);
    }

    const scene = sceneValue as Record<string, unknown>;
    if (!Number.isInteger(scene.sceneNumber) || ![1, 2, 3, 4].includes(scene.sceneNumber as number)) {
      throw new Error(`${label}.sceneNumber must be an integer from 1 to 4.`);
    }
    if (sceneNumbers.has(scene.sceneNumber as number)) {
      throw new Error('scenes must contain sceneNumber 1, 2, 3 and 4 exactly once.');
    }
    sceneNumbers.add(scene.sceneNumber as number);

    if (typeof scene.finalPrompt !== 'string' || !scene.finalPrompt.trim()) {
      throw new Error(`${label}.finalPrompt must be a non-empty string.`);
    }
    if (typeof scene.characterCount !== 'number' || !Number.isFinite(scene.characterCount)) {
      throw new Error(`${label}.characterCount must be a finite number.`);
    }
    if (typeof scene.primaryReferenceId !== 'string' || !scene.primaryReferenceId.trim()) {
      throw new Error(`${label}.primaryReferenceId must be a non-empty string.`);
    }
    if (!Array.isArray(scene.supportingReferenceIds) ||
        !scene.supportingReferenceIds.every((id) => typeof id === 'string')) {
      throw new Error(`${label}.supportingReferenceIds must be an array of strings.`);
    }
    if (!scene.inspectionMetadata ||
        typeof scene.inspectionMetadata !== 'object' ||
        Array.isArray(scene.inspectionMetadata)) {
      throw new Error(`${label}.inspectionMetadata must be an object.`);
    }

    const metadata = scene.inspectionMetadata as Record<string, unknown>;
    if (typeof metadata.productName !== 'string' || !metadata.productName.trim()) {
      throw new Error(`${label}.inspectionMetadata.productName must be a non-empty string.`);
    }
    if (typeof metadata.sceneMode !== 'string' || !sceneModes.has(metadata.sceneMode)) {
      throw new Error(`${label}.inspectionMetadata.sceneMode is invalid.`);
    }
    if (typeof metadata.action !== 'string' || !sceneActions.has(metadata.action)) {
      throw new Error(`${label}.inspectionMetadata.action is invalid.`);
    }
    if (typeof metadata.dialogue !== 'string') {
      throw new Error(`${label}.inspectionMetadata.dialogue must be a string.`);
    }
    if (typeof metadata.cameraIntent !== 'string' || !cameraIntents.has(metadata.cameraIntent)) {
      throw new Error(`${label}.inspectionMetadata.cameraIntent is invalid.`);
    }
  });

  if (sceneNumbers.size !== 4) {
    throw new Error('scenes must contain sceneNumber 1, 2, 3 and 4 exactly once.');
  }
}

function validateAndMapAnalysis(
  value: unknown,
  referenceSnapshot: readonly ReferenceImage[],
): LibraryAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Analysis response must be a JSON object.');
  }

  const response = value as Record<string, unknown>;
  if (Object.keys(response).length !== 2 ||
      !Object.hasOwn(response, 'generalSummary') ||
      !Object.hasOwn(response, 'analyses')) {
    throw new Error('Analysis response must contain only generalSummary and analyses.');
  }
  if (typeof response.generalSummary !== 'string') {
    throw new Error('Analysis generalSummary must be a string.');
  }
  if (!Array.isArray(response.analyses) || response.analyses.length !== referenceSnapshot.length) {
    throw new Error(`Analysis response must contain exactly ${referenceSnapshot.length} items.`);
  }

  const textFields = [
    'productDescription',
    'colorsAndVariants',
    'packagingAndAccessories',
    'clutterAndWatermarks',
    'humanPresence',
    'visualEvidence',
  ] as const;
  const seenIndices = new Set<number>();
  const validatedAnalyses = response.analyses.map((itemValue, itemPosition) => {
    const label = `analyses[${itemPosition}]`;
    if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) {
      throw new Error(`${label} must be an object.`);
    }

    const item = itemValue as Record<string, unknown>;
    if (Object.keys(item).length !== textFields.length + 1 ||
        !Object.hasOwn(item, 'inputIndex') ||
        !textFields.every((field) => Object.hasOwn(item, field))) {
      throw new Error(`${label} contains missing or unsupported fields.`);
    }
    if (!Number.isInteger(item.inputIndex)) {
      throw new Error(`${label}.inputIndex must be an integer.`);
    }

    const inputIndex = item.inputIndex as number;
    if (inputIndex < 0 || inputIndex >= referenceSnapshot.length) {
      throw new Error(`${label}.inputIndex is outside the reference snapshot.`);
    }
    if (seenIndices.has(inputIndex)) {
      throw new Error(`Analysis response contains duplicate inputIndex ${inputIndex}.`);
    }
    seenIndices.add(inputIndex);

    for (const field of textFields) {
      if (typeof item[field] !== 'string' || !item[field].trim()) {
        throw new Error(`${label}.${field} must be a non-empty string.`);
      }
    }

    return {
      inputIndex,
      productDescription: item.productDescription as string,
      colorsAndVariants: item.colorsAndVariants as string,
      packagingAndAccessories: item.packagingAndAccessories as string,
      clutterAndWatermarks: item.clutterAndWatermarks as string,
      humanPresence: item.humanPresence as string,
      visualEvidence: item.visualEvidence as string,
    };
  });

  for (let inputIndex = 0; inputIndex < referenceSnapshot.length; inputIndex += 1) {
    if (!seenIndices.has(inputIndex)) {
      throw new Error(`Analysis response is missing inputIndex ${inputIndex}.`);
    }
  }

  return {
    generalSummary: response.generalSummary,
    images: validatedAnalyses.map((item) => ({
      id: referenceSnapshot[item.inputIndex].id,
      productDescription: item.productDescription,
      colorsAndVariants: item.colorsAndVariants,
      packagingAndAccessories: item.packagingAndAccessories,
      clutterAndWatermarks: item.clutterAndWatermarks,
      humanPresence: item.humanPresence,
      visualEvidence: item.visualEvidence,
    })),
  };
}

function compactText(value: string, maximumLength: number) {
  return value.replace(/[\u0000-\u001f"\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}

function validateAndMapSelections(
  value: unknown,
  sceneSnapshot: readonly CompiledScenePromptV2[],
  analysisSnapshot: LibraryAnalysis,
): SceneSelection[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Selection response must be a JSON object.');
  }

  const response = value as Record<string, unknown>;
  if (!Array.isArray(response.selections) || response.selections.length !== 4) {
    throw new Error('Selection response must contain exactly 4 selections.');
  }

  const expectedSceneNumbers = new Set(sceneSnapshot.map((scene) => scene.sceneNumber));
  const seenSceneNumbers = new Set<number>();
  const validatedSelections = response.selections.map((selectionValue, position) => {
    const label = `selections[${position}]`;
    if (!selectionValue || typeof selectionValue !== 'object' || Array.isArray(selectionValue)) {
      throw new Error(`${label} must be an object.`);
    }

    const selection = selectionValue as Record<string, unknown>;
    if (!Number.isInteger(selection.sceneNumber) ||
        !expectedSceneNumbers.has(selection.sceneNumber as 1 | 2 | 3 | 4)) {
      throw new Error(`${label}.sceneNumber must be an integer from 1 to 4.`);
    }

    const sceneNumber = selection.sceneNumber as 1 | 2 | 3 | 4;
    if (seenSceneNumbers.has(sceneNumber)) {
      throw new Error(`Selection response contains duplicate sceneNumber ${sceneNumber}.`);
    }
    seenSceneNumbers.add(sceneNumber);

    if (!Array.isArray(selection.selectedIndices) || selection.selectedIndices.length === 0) {
      throw new Error(`${label}.selectedIndices must be a non-empty array.`);
    }

    const seenIndices = new Set<number>();
    const selectedIndices = selection.selectedIndices.map((indexValue, indexPosition) => {
      if (!Number.isInteger(indexValue)) {
        throw new Error(`${label}.selectedIndices[${indexPosition}] must be an integer.`);
      }

      const inputIndex = indexValue as number;
      if (inputIndex < 0 || inputIndex >= analysisSnapshot.images.length) {
        throw new Error(`${label}.selectedIndices[${indexPosition}] is outside the analysis snapshot.`);
      }
      if (seenIndices.has(inputIndex)) {
        throw new Error(`${label}.selectedIndices contains duplicate index ${inputIndex}.`);
      }
      seenIndices.add(inputIndex);
      return inputIndex;
    });

    if (typeof selection.reason !== 'string' || !selection.reason.trim()) {
      throw new Error(`${label}.reason must be a non-empty string.`);
    }

    return { sceneNumber, selectedIndices, reason: selection.reason };
  });

  for (const scene of sceneSnapshot) {
    if (!seenSceneNumbers.has(scene.sceneNumber)) {
      throw new Error(`Selection response is missing sceneNumber ${scene.sceneNumber}.`);
    }
  }

  return validatedSelections.map((selection) => ({
    sceneNumber: selection.sceneNumber,
    selectedLocalIds: selection.selectedIndices.map(
      (inputIndex) => analysisSnapshot.images[inputIndex].id,
    ),
    reason: selection.reason,
  }));
}

function readReference(file: File): Promise<ReferenceImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }

      const base64 = reader.result.split(',', 2)[1];
      if (!base64) {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }

      resolve({
        id: crypto.randomUUID(),
        base64,
        mimeType: file.type,
        name: file.name,
      });
    };

    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function reencodeReference(reference: ReferenceImage) {
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image decoding failed.'));
      image.src = `data:${reference.mimeType};base64,${reference.base64}`;
    });

    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error('Image has zero dimensions.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');

    context.drawImage(image, 0, 0);

    const outputMimeType = reference.mimeType === 'image/png'
      ? 'image/png'
      : reference.mimeType === 'image/webp'
        ? 'image/webp'
        : 'image/jpeg';
    const dataUrl = outputMimeType === 'image/png'
      ? canvas.toDataURL(outputMimeType)
      : canvas.toDataURL(outputMimeType, 0.95);
    const prefix = `data:${outputMimeType};base64,`;
    if (!dataUrl.startsWith(prefix)) throw new Error('Image encoding failed.');

    const base64 = dataUrl.slice(prefix.length);
    if (!base64) throw new Error('Encoded image is empty.');

    return { base64, mimeType: outputMimeType, preparationMode: 'REENCODED' as const };
  } catch {
    return {
      base64: reference.base64,
      mimeType: reference.mimeType,
      preparationMode: 'ORIGINAL_FALLBACK' as const,
    };
  }
}

function App() {
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [error, setError] = useState('');
  const [compiledSet, setCompiledSet] = useState<CompiledPromptSetV2 | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [rawCompiledSet, setRawCompiledSet] = useState('');
  const [importError, setImportError] = useState('');
  const [analysis, setAnalysis] = useState<LibraryAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisTokenRef = useRef<string | null>(null);
  const [selections, setSelections] = useState<SceneSelection[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectionTokenRef = useRef<string | null>(null);
  const [preparedScenes, setPreparedScenes] = useState<PreparedScene[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const preparationTokenRef = useRef<string | null>(null);
  const [generationPackages, setGenerationPackages] = useState<SceneGenerationPackage[]>([]);
  const [generationPackageError, setGenerationPackageError] = useState<string | null>(null);
  const isUploading = useRef(false);
  const replacingId = useRef<string | null>(null);
  const replacementInput = useRef<HTMLInputElement>(null);

  function invalidateGenerationPackages() {
    setGenerationPackages([]);
    setGenerationPackageError(null);
  }

  function invalidatePreparation() {
    preparationTokenRef.current = null;
    setPreparedScenes([]);
    setPreparationError(null);
    setIsPreparing(false);
    invalidateGenerationPackages();
  }

  function invalidateSelections() {
    selectionTokenRef.current = null;
    setSelections([]);
    setSelectionError(null);
    setIsSelecting(false);
    invalidatePreparation();
  }

  function invalidateAnalysis() {
    analysisTokenRef.current = null;
    setAnalysis(null);
    setAnalysisError(null);
    setIsAnalyzing(false);
    invalidateSelections();
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setError('');

    if (files.length === 0) return;

    if (isUploading.current) {
      setError('Please wait for the current images to finish loading.');
      return;
    }

    if (references.length + files.length > MAX_REFERENCES) {
      setError(`Maximum ${MAX_REFERENCES} reference images. No images were added.`);
      return;
    }

    isUploading.current = true;
    try {
      const uploadedReferences = await Promise.all(files.map(readReference));
      setReferences((current) => [...current, ...uploadedReferences]);
      invalidateAnalysis();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not read the selected images.');
    } finally {
      isUploading.current = false;
    }
  }

  function handleDelete(id: string) {
    setReferences((current) => current.filter((reference) => reference.id !== id));
    invalidateAnalysis();
  }

  function openReplacementPicker(id: string) {
    replacingId.current = id;
    replacementInput.current?.click();
  }

  async function handleReplace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const targetId = replacingId.current;
    event.target.value = '';
    replacingId.current = null;
    setError('');

    if (!file || !targetId) return;

    try {
      const replacement = await readReference(file);
      setReferences((current) =>
        current.map((reference) => reference.id === targetId ? replacement : reference),
      );
      invalidateAnalysis();
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : 'Could not read the selected image.');
    }
  }

  function openImport() {
    setRawCompiledSet('');
    setImportError('');
    setIsImportOpen(true);
  }

  function cancelImport() {
    setRawCompiledSet('');
    setImportError('');
    setIsImportOpen(false);
  }

  function confirmImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportError('');

    try {
      const parsed: unknown = JSON.parse(rawCompiledSet);
      validateCompiledPromptSet(parsed);
      setCompiledSet(parsed);
      invalidateSelections();
      setRawCompiledSet('');
      setIsImportOpen(false);
    } catch (importFailure) {
      setImportError(
        importFailure instanceof Error
          ? importFailure.message
          : 'Could not import CompiledPromptSetV2.',
      );
    }
  }

  async function analyzeLibrary() {
    if (references.length === 0) return;

    invalidateSelections();
    const referenceSnapshot = [...references];
    const requestToken = crypto.randomUUID();
    analysisTokenRef.current = requestToken;
    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch('/api/analyze-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: referenceSnapshot.map((reference) => ({
              base64: reference.base64,
              mimeType: reference.mimeType,
            })),
          }),
        });
        const responseText = await response.text();

        if (analysisTokenRef.current !== requestToken) return;

        if (!response.ok) {
          let message = `Library analysis failed with status ${response.status}.`;
          try {
            const errorBody: unknown = JSON.parse(responseText);
            if (errorBody && typeof errorBody === 'object' &&
                typeof (errorBody as Record<string, unknown>).error === 'string') {
              message = (errorBody as Record<string, string>).error;
            }
          } catch {
            // Keep the status-based message when the server error is not JSON.
          }
          throw new Error(message);
        }

        try {
          const parsed: unknown = JSON.parse(responseText);
          const validatedAnalysis = validateAndMapAnalysis(parsed, referenceSnapshot);
          if (analysisTokenRef.current !== requestToken) return;
          setAnalysis(validatedAnalysis);
          return;
        } catch (contractError) {
          if (analysisTokenRef.current !== requestToken) return;
          if (attempt === 0) continue;
          throw contractError;
        }
      }
    } catch (analysisFailure) {
      if (analysisTokenRef.current === requestToken) {
        setAnalysisError(
          analysisFailure instanceof Error
            ? analysisFailure.message
            : 'Library analysis failed.',
        );
      }
    } finally {
      if (analysisTokenRef.current === requestToken) {
        setIsAnalyzing(false);
      }
    }
  }

  async function selectReferences() {
    if (!compiledSet || !analysis || isAnalyzing || isSelecting) return;

    invalidatePreparation();
    const sceneSnapshot = [...compiledSet.scenes];
    const analysisSnapshot = {
      ...analysis,
      images: [...analysis.images],
    };
    const currentToken = crypto.randomUUID();
    selectionTokenRef.current = currentToken;
    setIsSelecting(true);
    setSelectionError(null);

    const requestBody = {
      references: analysisSnapshot.images.map((image, inputIndex) => ({
        inputIndex,
        productDescription: compactText(image.productDescription, 60),
        colorsAndVariants: compactText(image.colorsAndVariants, 40),
        packagingAndAccessories: compactText(image.packagingAndAccessories, 45),
        clutterAndWatermarks: compactText(image.clutterAndWatermarks, 35),
        humanPresence: compactText(image.humanPresence, 35),
        visualEvidence: compactText(image.visualEvidence, 60),
      })),
      scenes: sceneSnapshot.map((scene) => ({
        sceneNumber: scene.sceneNumber,
        productName: compactText(scene.inspectionMetadata.productName, 50),
        sceneMode: scene.inspectionMetadata.sceneMode,
        action: scene.inspectionMetadata.action,
        cameraIntent: scene.inspectionMetadata.cameraIntent,
        dialogue: compactText(scene.inspectionMetadata.dialogue, 60),
      })),
    };

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch('/api/select-references', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        const responseText = await response.text();

        if (selectionTokenRef.current !== currentToken) return;

        if (!response.ok) {
          let message = `Reference selection failed with status ${response.status}.`;
          try {
            const errorBody: unknown = JSON.parse(responseText);
            if (errorBody && typeof errorBody === 'object' &&
                typeof (errorBody as Record<string, unknown>).error === 'string') {
              message = (errorBody as Record<string, string>).error;
            }
          } catch {
            // Keep the status-based message when the server error is not JSON.
          }
          throw new Error(message);
        }

        try {
          const parsed: unknown = JSON.parse(responseText);
          const validatedSelections = validateAndMapSelections(
            parsed,
            sceneSnapshot,
            analysisSnapshot,
          );
          if (selectionTokenRef.current !== currentToken) return;
          setSelections(validatedSelections);
          return;
        } catch (contractError) {
          if (selectionTokenRef.current !== currentToken) return;
          if (attempt === 0) continue;
          throw contractError;
        }
      }
    } catch (selectionFailure) {
      if (selectionTokenRef.current === currentToken) {
        setSelectionError(
          selectionFailure instanceof Error
            ? selectionFailure.message
            : 'Reference selection failed.',
        );
      }
    } finally {
      if (selectionTokenRef.current === currentToken) {
        setIsSelecting(false);
      }
    }
  }

  async function prepareReferences() {
    invalidateGenerationPackages();
    if (!compiledSet || !analysis) {
      setPreparationError('Import prompts and analyze references before preparation.');
      return;
    }

    const referenceSnapshot = [...references];
    const analysisSnapshot = { ...analysis, images: [...analysis.images] };
    const selectionSnapshot = selections.map((selection) => ({
      ...selection,
      selectedLocalIds: [...selection.selectedLocalIds],
    }));
    const referenceIds = new Set(referenceSnapshot.map((reference) => reference.id));
    const analysisIds = new Set(analysisSnapshot.images.map((image) => image.id));
    const sceneNumbers = new Set<number>();

    try {
      if (selectionSnapshot.length !== 4) {
        throw new Error('Preparation requires exactly four scene selections.');
      }
      for (const selection of selectionSnapshot) {
        if (sceneNumbers.has(selection.sceneNumber)) {
          throw new Error(`Preparation contains duplicate scene ${selection.sceneNumber}.`);
        }
        sceneNumbers.add(selection.sceneNumber);
        if (selection.selectedLocalIds.length === 0) {
          throw new Error(`Scene ${selection.sceneNumber} requires at least one selected reference.`);
        }
        for (const localId of selection.selectedLocalIds) {
          if (!referenceIds.has(localId)) {
            throw new Error(`Scene ${selection.sceneNumber} references a missing local image.`);
          }
          if (!analysisIds.has(localId)) {
            throw new Error(`Scene ${selection.sceneNumber} references a missing image analysis.`);
          }
        }
      }
      for (const sceneNumber of [1, 2, 3, 4]) {
        if (!sceneNumbers.has(sceneNumber)) {
          throw new Error(`Preparation is missing scene ${sceneNumber}.`);
        }
      }
    } catch (coherenceError) {
      preparationTokenRef.current = null;
      setPreparedScenes([]);
      setIsPreparing(false);
      setPreparationError(
        coherenceError instanceof Error ? coherenceError.message : 'Preparation input is invalid.',
      );
      return;
    }

    const currentToken = crypto.randomUUID();
    preparationTokenRef.current = currentToken;
    setPreparedScenes([]);
    setIsPreparing(true);
    setPreparationError(null);

    const uniqueLocalIds: string[] = [];
    const seenLocalIds = new Set<string>();
    for (const selection of selectionSnapshot) {
      for (const localId of selection.selectedLocalIds) {
        if (!seenLocalIds.has(localId)) {
          seenLocalIds.add(localId);
          uniqueLocalIds.push(localId);
        }
      }
    }

    try {
      const preparedEntries = await Promise.all(uniqueLocalIds.map(async (localId) => {
        const reference = referenceSnapshot.find((item) => item.id === localId)!;
        const imageAnalysis = analysisSnapshot.images.find((item) => item.id === localId)!;
        const encoded = await reencodeReference(reference);
        return {
          localId,
          name: reference.name,
          ...encoded,
          clutterAndWatermarks: imageAnalysis.clutterAndWatermarks,
          humanPresence: imageAnalysis.humanPresence,
        };
      }));

      if (preparationTokenRef.current !== currentToken) return;

      const preparedByLocalId = new Map(
        preparedEntries.map((preparedReference) => [preparedReference.localId, preparedReference]),
      );
      setPreparedScenes(selectionSnapshot.map((selection) => ({
        sceneNumber: selection.sceneNumber,
        preparedReferences: selection.selectedLocalIds.map(
          (localId) => preparedByLocalId.get(localId)!,
        ),
      })));
    } catch (preparationFailure) {
      if (preparationTokenRef.current === currentToken) {
        setPreparedScenes([]);
        setPreparationError(
          preparationFailure instanceof Error
            ? preparationFailure.message
            : 'Reference preparation failed.',
        );
      }
    } finally {
      if (preparationTokenRef.current === currentToken) {
        setIsPreparing(false);
      }
    }
  }

  function buildGenerationPackages() {
    setGenerationPackageError(null);

    try {
      if (!compiledSet) throw new Error('Import CompiledPromptSetV2 before building packages.');
      if (isAnalyzing || isSelecting || isPreparing) {
        throw new Error('Wait for current reference processing to finish.');
      }
      if (compiledSet.scenes.length !== 4) {
        throw new Error('Generation packages require exactly four compiled scenes.');
      }
      if (preparedScenes.length !== 4) {
        throw new Error('Generation packages require exactly four prepared scenes.');
      }

      const compiledSceneNumbers = new Set<number>();
      for (const scene of compiledSet.scenes) {
        if (compiledSceneNumbers.has(scene.sceneNumber)) {
          throw new Error(`Compiled scenes contain duplicate scene ${scene.sceneNumber}.`);
        }
        compiledSceneNumbers.add(scene.sceneNumber);
      }

      const preparedBySceneNumber = new Map<number, PreparedScene>();
      for (const preparedScene of preparedScenes) {
        if (preparedBySceneNumber.has(preparedScene.sceneNumber)) {
          throw new Error(`Prepared scenes contain duplicate scene ${preparedScene.sceneNumber}.`);
        }
        if (preparedScene.preparedReferences.length === 0) {
          throw new Error(`Prepared scene ${preparedScene.sceneNumber} has no references.`);
        }

        for (const reference of preparedScene.preparedReferences) {
          if (typeof reference.localId !== 'string' || !reference.localId.trim()) {
            throw new Error(`Prepared scene ${preparedScene.sceneNumber} has an invalid localId.`);
          }
          if (typeof reference.name !== 'string') {
            throw new Error(`Prepared scene ${preparedScene.sceneNumber} has an invalid name.`);
          }
          if (typeof reference.mimeType !== 'string' || !reference.mimeType.startsWith('image/')) {
            throw new Error(`Prepared scene ${preparedScene.sceneNumber} has an invalid mimeType.`);
          }
          if (typeof reference.base64 !== 'string' || !reference.base64.trim()) {
            throw new Error(`Prepared scene ${preparedScene.sceneNumber} has empty image data.`);
          }
          if (reference.preparationMode !== 'REENCODED' &&
              reference.preparationMode !== 'ORIGINAL_FALLBACK') {
            throw new Error(`Prepared scene ${preparedScene.sceneNumber} has an invalid preparation mode.`);
          }
          if (typeof reference.clutterAndWatermarks !== 'string' ||
              typeof reference.humanPresence !== 'string') {
            throw new Error(`Prepared scene ${preparedScene.sceneNumber} has invalid evidence.`);
          }
        }

        preparedBySceneNumber.set(preparedScene.sceneNumber, preparedScene);
      }

      for (const sceneNumber of [1, 2, 3, 4]) {
        if (!compiledSceneNumbers.has(sceneNumber)) {
          throw new Error(`Compiled scenes are missing scene ${sceneNumber}.`);
        }
        if (!preparedBySceneNumber.has(sceneNumber)) {
          throw new Error(`Prepared scenes are missing scene ${sceneNumber}.`);
        }
      }

      const nextPackages: SceneGenerationPackage[] = compiledSet.scenes.map((scene) => ({
        sceneNumber: scene.sceneNumber,
        finalPrompt: scene.finalPrompt,
        voiceGender: compiledSet.voiceGender,
        aspectRatio: '9:16',
        durationSeconds: 8,
        references: preparedBySceneNumber.get(scene.sceneNumber)!.preparedReferences.map(
          (reference) => ({ ...reference }),
        ),
      }));

      if (nextPackages.length !== 4) {
        throw new Error('Generation package build did not produce exactly four packages.');
      }
      setGenerationPackages(nextPackages);
    } catch (packageFailure) {
      setGenerationPackages([]);
      setGenerationPackageError(
        packageFailure instanceof Error
          ? packageFailure.message
          : 'Generation package build failed.',
      );
    }
  }

  const isReady = references.length >= 1 && references.length <= MAX_REFERENCES;
  const canSelectReferences = Boolean(compiledSet && analysis && !isAnalyzing && !isSelecting);
  const canPrepareReferences = Boolean(
    compiledSet &&
    analysis &&
    selections.length === 4 &&
    !isAnalyzing &&
    !isSelecting &&
    !isPreparing,
  );
  const canBuildGenerationPackages = Boolean(
    compiledSet &&
    preparedScenes.length === 4 &&
    !isAnalyzing &&
    !isSelecting &&
    !isPreparing,
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">MOCHI SCENES V4 · G0–G7</p>
          <h1>Local Reference Library</h1>
          <p className="subtitle">Prepare up to five local product references for future scene stages.</p>
        </div>
        <div className={`readiness ${isReady ? 'readiness--ready' : ''}`}>
          <span aria-hidden="true" />
          <div>
            <strong>{isReady ? 'Ready for scenes' : 'Not ready'}</strong>
            <small>{references.length} / {MAX_REFERENCES} references</small>
          </div>
        </div>
      </header>

      <section className="import-panel" aria-labelledby="import-title">
        <div className="import-heading">
          <div>
            <h2 id="import-title">CompiledPromptSetV2</h2>
            {compiledSet ? (
              <p className="imported-summary">
                Imported · {compiledSet.scenes.length} scenes · {compiledSet.voiceGender}
                <span title={compiledSet.sourceFingerprint}>{compiledSet.sourceFingerprint}</span>
              </p>
            ) : (
              <p>No compiled prompt set imported.</p>
            )}
          </div>
          {!isImportOpen && (
            <button className="primary-control" type="button" onClick={openImport}>
              {compiledSet ? 'Replace import' : 'Import CompiledPromptSetV2'}
            </button>
          )}
        </div>

        {isImportOpen && (
          <form className="import-form" onSubmit={confirmImport}>
            <label htmlFor="compiled-set-json">Paste raw CompiledPromptSetV2 JSON</label>
            <textarea
              id="compiled-set-json"
              value={rawCompiledSet}
              onChange={(event) => setRawCompiledSet(event.target.value)}
              placeholder="{ &quot;compilerVersion&quot;: 1, ... }"
              rows={12}
              spellCheck={false}
              autoFocus
            />
            {importError && <p className="error-message" role="alert">{importError}</p>}
            <div className="import-actions">
              <button type="button" onClick={cancelImport}>Cancel</button>
              <button className="primary-control" type="submit">Confirm import</button>
            </div>
          </form>
        )}
      </section>

      <section className="intake-panel" aria-labelledby="intake-title">
        <div>
          <h2 id="intake-title">Reference intake</h2>
          <p>Select one or multiple image files. Images stay in this browser session.</p>
        </div>
        <div className="intake-actions">
          {references.length > 0 && (
            <button type="button" onClick={analyzeLibrary} disabled={isAnalyzing}>
              {isAnalyzing ? 'Analyzing library…' : 'Analyze Library'}
            </button>
          )}
          <label className="primary-control">
            Upload images
            <input type="file" accept="image/*" multiple onChange={handleUpload} />
          </label>
        </div>
      </section>

      {error && <p className="error-message" role="alert">{error}</p>}
      {analysisError && <p className="error-message" role="alert">{analysisError}</p>}
      {selectionError && <p className="error-message" role="alert">{selectionError}</p>}
      {preparationError && <p className="error-message" role="alert">{preparationError}</p>}
      {generationPackageError && (
        <p className="error-message" role="alert">{generationPackageError}</p>
      )}

      <input
        ref={replacementInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={handleReplace}
      />

      {references.length === 0 ? (
        <section className="empty-state">
          <span aria-hidden="true">+</span>
          <h2>No reference images</h2>
          <p>Upload at least one image to make the local library ready.</p>
        </section>
      ) : (
        <section className="reference-grid" aria-label="Uploaded reference images">
          {references.map((reference, index) => (
            <article className="reference-card" key={reference.id}>
              <img
                src={`data:${reference.mimeType};base64,${reference.base64}`}
                alt={`Reference ${index + 1}: ${reference.name}`}
              />
              <div className="reference-content">
                <p className="reference-label">REFERENCE {index + 1}</p>
                <h2 title={reference.name}>{reference.name}</h2>
                <p className="mime-type">{reference.mimeType || 'image'}</p>
                <div className="reference-actions">
                  <button type="button" onClick={() => openReplacementPicker(reference.id)}>
                    Replace
                  </button>
                  <button className="delete-control" type="button" onClick={() => handleDelete(reference.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {analysis && (
        <section className="library-analysis" aria-labelledby="library-analysis-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">GLOBAL REFERENCE ANALYSIS</p>
              <h2 id="library-analysis-title">Library Analysis</h2>
            </div>
            <div className="section-actions">
              <span>{analysis.images.length} analyzed references</span>
              {compiledSet && (
                <button
                  className="primary-control"
                  type="button"
                  onClick={selectReferences}
                  disabled={!canSelectReferences}
                >
                  {isSelecting ? 'Selecting references…' : 'Select References'}
                </button>
              )}
              {selections.length === 4 && (
                <button
                  className="primary-control"
                  type="button"
                  onClick={prepareReferences}
                  disabled={!canPrepareReferences}
                >
                  {isPreparing ? 'Preparing references…' : 'Prepare References'}
                </button>
              )}
              {selections.length === 4 && (
                <button
                  type="button"
                  onClick={buildGenerationPackages}
                  disabled={!canBuildGenerationPackages}
                >
                  Build Generation Packages
                </button>
              )}
            </div>
          </div>

          {generationPackages.length === 4 && (
            <p className="generation-ready" role="status">
              Generation Packages Ready — 4 / 4
            </p>
          )}

          <p className="analysis-summary">{analysis.generalSummary}</p>

          <div className="analysis-grid">
            {analysis.images.map((image) => (
              <article className="analysis-card" key={image.id}>
                <header>
                  <p className="reference-label">LOCAL REFERENCE</p>
                  <h3>
                    {references.find((reference) => reference.id === image.id)?.name
                      ?? 'Reference unavailable'}
                  </h3>
                </header>
                <dl className="analysis-fields">
                  <div>
                    <dt>Product</dt>
                    <dd>{image.productDescription}</dd>
                  </div>
                  <div>
                    <dt>Colors & variants</dt>
                    <dd>{image.colorsAndVariants}</dd>
                  </div>
                  <div>
                    <dt>Packaging & accessories</dt>
                    <dd>{image.packagingAndAccessories}</dd>
                  </div>
                  <div>
                    <dt>Clutter & watermarks</dt>
                    <dd>{image.clutterAndWatermarks}</dd>
                  </div>
                  <div>
                    <dt>Human presence</dt>
                    <dd>{image.humanPresence}</dd>
                  </div>
                  <div>
                    <dt>Visual evidence</dt>
                    <dd>{image.visualEvidence}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}

      {compiledSet && (
        <section className="compiled-scenes" aria-labelledby="compiled-scenes-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">IMPORTED OUTPUT</p>
              <h2 id="compiled-scenes-title">Compiled Scenes</h2>
            </div>
            <span>{compiledSet.scenes.length} scene shells</span>
          </div>

          <div className="scene-grid">
            {compiledSet.scenes.map((scene) => {
              const selection = selections.find(
                (candidate) => candidate.sceneNumber === scene.sceneNumber,
              );
              const preparedScene = preparedScenes.find(
                (candidate) => candidate.sceneNumber === scene.sceneNumber,
              );
              const generationPackage = generationPackages.find(
                (candidate) => candidate.sceneNumber === scene.sceneNumber,
              );

              return (
                <article className="scene-shell" key={scene.sceneNumber}>
                <header className="scene-header">
                  <div>
                    <p className="scene-label">SCENE {scene.sceneNumber}</p>
                    <h3>{scene.inspectionMetadata.productName}</h3>
                  </div>
                  <span>{scene.characterCount} characters</span>
                </header>

                <dl className="scene-metadata">
                  <div>
                    <dt>Mode</dt>
                    <dd>{scene.inspectionMetadata.sceneMode}</dd>
                  </div>
                  <div>
                    <dt>Action</dt>
                    <dd>{scene.inspectionMetadata.action}</dd>
                  </div>
                  <div>
                    <dt>Camera</dt>
                    <dd>{scene.inspectionMetadata.cameraIntent}</dd>
                  </div>
                </dl>

                <div className="scene-block">
                  <h4>Dialogue</h4>
                  <p>{scene.inspectionMetadata.dialogue}</p>
                </div>

                <div className="scene-block">
                  <h4>Final prompt</h4>
                  <p className="final-prompt">{scene.finalPrompt}</p>
                </div>

                <div className="scene-block matched-references">
                  <div className="matched-heading">
                    <h4>Matched References</h4>
                    <span className={selection ? 'matched-status' : 'unmatched-status'}>
                      {selection ? 'Matched' : 'No selection'}
                    </span>
                  </div>
                  {selection && (
                    <>
                      <div className="matched-thumbnails">
                        {selection.selectedLocalIds.map((localId) => {
                          const reference = references.find((item) => item.id === localId);
                          return (
                            <figure key={localId}>
                              {reference ? (
                                <img
                                  src={`data:${reference.mimeType};base64,${reference.base64}`}
                                  alt={reference.name}
                                />
                              ) : (
                                <div className="missing-thumbnail">Unavailable</div>
                              )}
                              <figcaption>{reference?.name ?? localId}</figcaption>
                            </figure>
                          );
                        })}
                      </div>
                      <p className="selection-reason">{selection.reason}</p>
                    </>
                  )}
                </div>

                <div className="scene-block prepared-references">
                  <div className="matched-heading">
                    <h4>Prepared References</h4>
                    <span className={preparedScene ? 'matched-status' : 'unmatched-status'}>
                      {preparedScene ? 'Prepared' : 'Not prepared'}
                    </span>
                  </div>
                  {preparedScene && (
                    <ul>
                      {preparedScene.preparedReferences.map((preparedReference) => (
                        <li key={preparedReference.localId}>
                          <span>{preparedReference.name}</span>
                          <strong>{preparedReference.preparationMode}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="scene-block generation-package">
                  <div className="matched-heading">
                    <h4>Generation Package</h4>
                    <span className={generationPackage ? 'matched-status' : 'unmatched-status'}>
                      {generationPackage ? 'Ready' : 'Not ready'}
                    </span>
                  </div>
                  {generationPackage && (
                    <dl>
                      <div>
                        <dt>Frame</dt>
                        <dd>{generationPackage.aspectRatio}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>{generationPackage.durationSeconds} seconds</dd>
                      </div>
                      <div>
                        <dt>Voice</dt>
                        <dd>{generationPackage.voiceGender}</dd>
                      </div>
                      <div>
                        <dt>References</dt>
                        <dd>{generationPackage.references.length}</dd>
                      </div>
                    </dl>
                  )}
                </div>

                <div className="scene-block original-ids">
                  <h4>Original IDs</h4>
                  <dl>
                    <div>
                      <dt>Primary</dt>
                      <dd>{scene.primaryReferenceId}</dd>
                    </div>
                    <div>
                      <dt>Supporting</dt>
                      <dd>
                        {scene.supportingReferenceIds.length > 0
                          ? scene.supportingReferenceIds.join(', ')
                          : 'None'}
                      </dd>
                    </div>
                  </dl>
                </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

export default App;

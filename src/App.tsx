import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { CompiledPromptSetV2, LibraryAnalysis, ReferenceImage } from './types';

const MAX_REFERENCES = 5;

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
  const isUploading = useRef(false);
  const replacingId = useRef<string | null>(null);
  const replacementInput = useRef<HTMLInputElement>(null);

  function invalidateAnalysis() {
    analysisTokenRef.current = null;
    setAnalysis(null);
    setAnalysisError(null);
    setIsAnalyzing(false);
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

  const isReady = references.length >= 1 && references.length <= MAX_REFERENCES;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">MOCHI SCENES V4 · G0–G4</p>
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
            <span>{analysis.images.length} analyzed references</span>
          </div>

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
            {compiledSet.scenes.map((scene) => (
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
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export default App;

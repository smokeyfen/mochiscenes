import { useRef, useState, type ChangeEvent } from 'react';
import type { ReferenceImage } from './types';

const MAX_REFERENCES = 5;

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
  const isUploading = useRef(false);
  const replacingId = useRef<string | null>(null);
  const replacementInput = useRef<HTMLInputElement>(null);

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
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not read the selected images.');
    } finally {
      isUploading.current = false;
    }
  }

  function handleDelete(id: string) {
    setReferences((current) => current.filter((reference) => reference.id !== id));
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
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : 'Could not read the selected image.');
    }
  }

  const isReady = references.length >= 1 && references.length <= MAX_REFERENCES;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">MOCHI SCENES V4 · G0/G1</p>
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

      <section className="intake-panel" aria-labelledby="intake-title">
        <div>
          <h2 id="intake-title">Reference intake</h2>
          <p>Select one or multiple image files. Images stay in this browser session.</p>
        </div>
        <label className="primary-control">
          Upload images
          <input type="file" accept="image/*" multiple onChange={handleUpload} />
        </label>
      </section>

      {error && <p className="error-message" role="alert">{error}</p>}

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
    </main>
  );
}

export default App;

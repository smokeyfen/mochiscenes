export type VoiceGender = 'FEMALE' | 'MALE';

export type SceneMode =
  | 'PRESENTATION'
  | 'DEMONSTRATION';

export type SceneAction =
  | 'PRESENT'
  | 'MOVE'
  | 'REORIENT'
  | 'PRESS_RELEASE'
  | 'OPEN'
  | 'CLOSE'
  | 'CONNECT'
  | 'DISCONNECT'
  | 'REMOVE';

export type CameraIntent =
  | 'OVERVIEW_REVEAL'
  | 'ACTION_READABILITY'
  | 'DETAIL_INSPECTION'
  | 'PRODUCT_PRESENTATION';

export interface ReferenceImage {
  id: string;
  base64: string;
  mimeType: string;
  name: string;
}

export interface ImageAnalysis {
  id: string;
  productDescription: string;
  colorsAndVariants: string;
  packagingAndAccessories: string;
  clutterAndWatermarks: string;
  humanPresence: string;
  visualEvidence: string;
}

export interface LibraryAnalysis {
  images: ImageAnalysis[];
  generalSummary: string;
}

export interface SceneSelection {
  sceneNumber: 1 | 2 | 3 | 4;
  selectedLocalIds: string[];
  reason: string;
}

export interface CompiledScenePromptV2 {
  sceneNumber: 1 | 2 | 3 | 4;
  finalPrompt: string;
  characterCount: number;
  primaryReferenceId: string;
  supportingReferenceIds: readonly string[];

  inspectionMetadata: {
    productName: string;
    sceneMode: SceneMode;
    action: SceneAction;
    dialogue: string;
    cameraIntent: CameraIntent;
  };
}

export interface CompiledPromptSetV2 {
  compilerVersion: 1;
  sourceFingerprint: string;
  voiceGender: VoiceGender;

  scenes: readonly [
    CompiledScenePromptV2,
    CompiledScenePromptV2,
    CompiledScenePromptV2,
    CompiledScenePromptV2
  ];
}


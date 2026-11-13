export type Language = 'ar' | 'en';
export type ExportResolution = '720p' | '1080p' | 'source';
export type Panel = 'projects' | 'editor' | 'media' | 'audio' | 'color' | 'captions' | 'assistant' | 'storage' | 'settings';

export interface MediaAsset {
  id: string;
  name: string;
  mime: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  createdAt: number;
}

export interface TimelineClip {
  id: string;
  mediaId: string;
  name: string;
  start: number;
  end: number;
  sourceDuration: number;
  speed: number;
  volume: number;
  muted: boolean;
}

export interface ColorSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
}

export interface AudioSettings {
  noiseReduction: boolean;
  normalize: boolean;
  highpass: boolean;
  gain: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  clips: TimelineClip[];
  color: ColorSettings;
  audio: AudioSettings;
  aspectRatio: 'original' | '16:9' | '9:16' | '1:1' | '4:5';
  exportResolution: ExportResolution;
}

export interface SilenceRange { start: number; end: number; duration: number }
export interface EditingOperation {
  type: 'remove_silence' | 'brightness' | 'noise_reduction' | 'cinematic' | 'aspect_ratio' | 'dynamic_cut';
  label: string;
  value?: number | string | boolean;
  supported: boolean;
}
export interface EditingPlan {
  originalRequest: string;
  operations: EditingOperation[];
  requiresReview: true;
}

export const DEFAULT_COLOR: ColorSettings = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  exposure: 0,
};
export const DEFAULT_AUDIO: AudioSettings = {
  noiseReduction: false,
  normalize: true,
  highpass: false,
  gain: 1,
};
